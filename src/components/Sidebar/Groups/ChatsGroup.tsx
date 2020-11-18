import React, { useCallback, useEffect, useReducer } from "react";
import useConference from "../../../hooks/useConference";
import useMaybeUserProfile from "../../../hooks/useMaybeUserProfile";
import MenuExpander, { ButtonSpec } from "../Menu/MenuExpander";
import MenuGroup, { MenuGroupItems } from "../Menu/MenuGroup";
import MenuItem from "../Menu/MenuItem";
import { Conference, UserProfile, WatchedItems } from "@clowdr-app/clowdr-db-schema";
import { makeCancelable } from "@clowdr-app/clowdr-db-schema/build/Util";
import useMaybeChat from "../../../hooks/useMaybeChat";
import { ChatDescriptor, MemberDescriptor } from "../../../classes/Chat";
import assert from "assert";
import { ServiceEventNames } from "../../../classes/Chat/Services/Twilio/ChatService";
import { LoadingSpinner } from "../../LoadingSpinner/LoadingSpinner";
import useLogger from "../../../hooks/useLogger";
import {
    DataDeletedEventDetails,
    DataUpdatedEventDetails,
} from "@clowdr-app/clowdr-db-schema/build/DataLayer/Cache/Cache";
import useDataSubscription from "../../../hooks/useDataSubscription";
import useSafeAsync from "../../../hooks/useSafeAsync";
import { randomBackoff } from "../../RandomPrompts/RandomPrompts";
// import { addNotification } from '../../../classes/Notifications/Notifications';
// import ReactMarkdown from 'react-markdown';
// import { emojify } from 'react-emojione';
// import { useLocation } from 'react-router-dom';

type ChatGroupTasks = "loadingActiveChats" | "loadingAllChats";

export type SidebarChatDescriptor = {
    exists: true;
    id: string;
    friendlyName: string;
    isModeration: boolean;
    isModerationHub: boolean;
    unreadCount?: number;
} & (
        | {
            isDM: false;
        }
        | {
            isDM: true;
            otherMembers: (MemberDescriptor<boolean | undefined> & { displayName: string })[];
        }
    );

type FilteredChatDescriptor =
    | (ChatDescriptor & { exists: true })
    | {
        exists: false;
        friendlyName: string;
        targetPath: string;
    };

type FilteredSidebarChatDescriptor =
    | SidebarChatDescriptor
    | {
        exists: false;
        friendlyName: string;
        targetPath: string;
    };

export type SidebarUserDescriptor = {
    id: string;
    name: string;
    isBanned: boolean;
};

interface ChatsGroupState {
    tasks: Set<ChatGroupTasks>;
    isOpen: boolean;
    chatSearch: string | null;
    activeChats: Array<SidebarChatDescriptor> | null;
    allChats: Array<ChatDescriptor> | null;
    watchedChatIds: Array<string> | null;
    filteredChats: Array<FilteredSidebarChatDescriptor>;
    allUsers: Array<SidebarUserDescriptor> | null;
    randomDeterminant: number;
}

type ChatsGroupUpdate =
    | { action: "updateAllChats"; chats: Array<ChatDescriptor> }
    | { action: "setActiveChats"; chats: Array<SidebarChatDescriptor> }
    | { action: "updateActiveChats"; chats: Array<SidebarChatDescriptor> }
    | { action: "updateFilteredChats"; chats: Array<FilteredSidebarChatDescriptor> }
    | { action: "deleteFromActiveChats"; chats: Array<string> }
    | { action: "deleteFromAllChats"; chats: Array<string> }
    | { action: "searchChats"; search: string | null }
    | { action: "setIsOpen"; isOpen: boolean }
    | {
        action: "updateChatDescriptors";
        fActive: (x: SidebarChatDescriptor) => SidebarChatDescriptor;
        fFiltered: (x: FilteredSidebarChatDescriptor) => FilteredSidebarChatDescriptor;
    }
    | { action: "setWatchedChatIds"; ids: Array<string> }
    | {
        action: "updateAllUsers";
        update: (old: Array<SidebarUserDescriptor> | null) => Array<SidebarUserDescriptor> | null;
    };

async function filterChats(
    allChats: Array<ChatDescriptor>,
    allUsers: Array<SidebarUserDescriptor>,
    currentUserProfileId: string | undefined,
    _search: string | null,
    minSearchLength: number
): Promise<Array<FilteredChatDescriptor>> {
    if (_search && _search.length >= minSearchLength) {
        const search = _search.toLowerCase();
        const filteredUsers = allUsers.filter(
            x => x.name.toLowerCase().includes(search) && x.id !== currentUserProfileId && !x.isBanned
        );
        const filteredChats = allChats
            .filter(
                x =>
                    x.friendlyName.toLowerCase().includes(search) ||
                    (x.isDM &&
                        (
                            (x.member1.profileId === currentUserProfileId && filteredUsers.some(y => y.id === x.member2.profileId)) ||
                            (x.member2.profileId === currentUserProfileId && filteredUsers.some(y => y.id === x.member1.profileId))
                        )
                    )
        );
        const mappedResults: FilteredChatDescriptor[] = filteredChats.map(x => ({ ...x, exists: true }));
        return mappedResults.concat(
            filteredUsers
                .filter(
                    p =>
                        !filteredChats.some(c => {
                            return c.isDM && (c.member1.profileId === p.id || c.member2.profileId === p.id);
                        })
                    && p.name.toLowerCase().includes(search)
                )
                .map(p => ({
                    exists: false,
                    friendlyName: p.name,
                    targetPath: `/chat/new/${p.id}`,
                }))
        );
    } else {
        return [];
    }
}

function nextSidebarState(
    currentState: ChatsGroupState,
    updates: ChatsGroupUpdate | Array<ChatsGroupUpdate>
): ChatsGroupState {
    const nextState: ChatsGroupState = {
        tasks: new Set(currentState.tasks),
        isOpen: currentState.isOpen,
        chatSearch: currentState.chatSearch,
        allChats: currentState.allChats,
        activeChats: currentState.activeChats,
        filteredChats: currentState.filteredChats,
        watchedChatIds: currentState.watchedChatIds,
        allUsers: currentState.allUsers,
        randomDeterminant: Math.random(),
    };

    let allChatsUpdated = false;
    let activeChatsUpdated = false;

    function doUpdate(update: ChatsGroupUpdate) {
        switch (update.action) {
            case "searchChats":
                nextState.chatSearch = update.search?.length ? update.search : null;
                break;
            case "setIsOpen":
                nextState.isOpen = update.isOpen;
                break;
            case "updateAllChats":
                {
                    const changes = [...update.chats];
                    const updatedIds = changes.map(x => x.id);
                    nextState.allChats =
                        nextState.allChats?.map(x => {
                            const idx = updatedIds.indexOf(x.id);
                            if (idx > -1) {
                                const y = changes[idx];
                                updatedIds.splice(idx, 1);
                                changes.splice(idx, 1);
                                return y;
                            } else {
                                return x;
                            }
                        }) ?? null;
                    nextState.allChats = nextState.allChats?.concat(changes) ?? changes;
                    allChatsUpdated = true;
                }
                break;
            case "updateActiveChats":
                {
                    const changes = [...update.chats];
                    const updatedIds = changes.map(x => x.id);
                    nextState.activeChats =
                        nextState.activeChats?.map(x => {
                            const idx = updatedIds.indexOf(x.id);
                            if (idx > -1) {
                                const y = changes[idx];
                                updatedIds.splice(idx, 1);
                                changes.splice(idx, 1);
                                return y;
                            } else {
                                return x;
                            }
                        }) ?? null;
                    nextState.activeChats = nextState.activeChats?.concat(changes) ?? changes;
                    activeChatsUpdated = true;
                }
                break;
            case "deleteFromActiveChats":
                nextState.activeChats = nextState.activeChats?.filter(x => !update.chats.includes(x.id)) ?? null;
                activeChatsUpdated = true;
                break;
            case "deleteFromAllChats":
                nextState.allChats = nextState.allChats?.filter(x => !update.chats.includes(x.id)) ?? null;
                allChatsUpdated = true;
                break;

            case "updateFilteredChats":
                nextState.filteredChats = update.chats;
                break;
            case "updateChatDescriptors":
                if (nextState.activeChats) {
                    nextState.activeChats = nextState.activeChats.map(update.fActive);
                }

                if (nextState.allChats) {
                    nextState.filteredChats = nextState.filteredChats.map(update.fFiltered);
                }
                break;

            case "setActiveChats":
                nextState.activeChats = update.chats;
                activeChatsUpdated = true;
                break;
            case "setWatchedChatIds":
                nextState.watchedChatIds = update.ids;
                break;

            case "updateAllUsers":
                nextState.allUsers = update.update(nextState.allUsers ? [...nextState.allUsers] : null);
                break;
        }
    }

    if (updates instanceof Array) {
        updates.forEach(doUpdate);
    } else {
        doUpdate(updates);
    }

    if (allChatsUpdated) {
        if (nextState.allChats) {
            nextState.tasks.delete("loadingAllChats");
        } else {
            nextState.filteredChats = [];
        }
    }

    if (activeChatsUpdated) {
        nextState.tasks.delete("loadingActiveChats");
    }

    return nextState;
}

export async function upgradeChatDescriptor(conf: Conference, x: ChatDescriptor, currentUserProfileId?: string, activeChatIds?: string[]): Promise<SidebarChatDescriptor> {
    const unreadCount = activeChatIds && activeChatIds.includes(x.id) ? await x.getUnreadCount() : undefined;
    if (x.isDM) {
        const otherProfilePromises = [];

        if (!currentUserProfileId || x.member1.profileId !== currentUserProfileId) {
            otherProfilePromises.push(UserProfile.get(x.member1.profileId, conf.id).then(
                y => {
                    assert(y);
                    return {
                        member: x.member1,
                        profile: y
                    };
                }
            ));
        }

        if (!currentUserProfileId || x.member2.profileId !== currentUserProfileId) {
            otherProfilePromises.push(UserProfile.get(x.member2.profileId, conf.id).then(
                y => {
                    assert(y);
                    return {
                        member: x.member2,
                        profile: y
                    };
                }
            ));
        }

        const ps = await Promise.all(otherProfilePromises);
        const otherMembers = await Promise.all(ps.map(async p => ({
            ...p.member,
            isOnline: await p.member.isOnline,
            displayName: p.profile.displayName
        })));

        return {
            ...x,
            unreadCount,
            exists: true,
            otherMembers
        };
    } else {
        return {
            ...x,
            unreadCount,
            exists: true,
        };
    }
}

export function computeChatDisplayName(chat: SidebarChatDescriptor, mUser: UserProfile) {
    let friendlyName: string;
    let icon: JSX.Element;

    if (chat.isDM) {
        const member = chat.otherMembers[0];
        const otherOnline = member.isOnline;
        friendlyName = member.displayName;

        icon = <i className={`fa${otherOnline ? "s" : "r"} fa-circle ${otherOnline ? "online" : ""}`}></i>;
    } else {
        // Group chat - use chat friendly name from Twilio
        friendlyName = chat.friendlyName;
        icon = <i className="fas fa-hashtag"></i>;
    }

    return { friendlyName, icon, unreadCount: chat.unreadCount, isDM: chat.isDM };
}

interface Props {
    minSearchLength: number;
    onItemClicked?: () => void;
}

export default function ChatsGroup(props: Props) {
    const conf = useConference();
    const mUser = useMaybeUserProfile();
    const mChat = useMaybeChat();
    const logger = useLogger("ChatsGroup");
    const [state, dispatchUpdate] = useReducer(nextSidebarState, {
        tasks: new Set(["loadingChats", "loadingActiveChats"] as ChatGroupTasks[]),
        isOpen: true,
        chatSearch: null,
        allChats: null,
        activeChats: null,
        watchedChatIds: null,
        filteredChats: [],
        allUsers: null,
        randomDeterminant: Math.random(),
    });

    logger.enable();

    useSafeAsync(
        async () => {
            if (mUser && mChat) {
                const chats = await mChat.listWatchedChats();
                const activeChatIds = chats.map(y => y.id);
                const chatsWithName: Array<SidebarChatDescriptor> = await Promise.all(
                    chats.map(x => upgradeChatDescriptor(conf, x, mUser.id, activeChatIds))
                );
                return chatsWithName;
            }
            return null;
        },
        (data: Array<SidebarChatDescriptor> | null) => {
            if (data) {
                dispatchUpdate({
                    action: "setActiveChats",
                    chats: data,
                });
            }
            // state.watchedChatIds is required so that active chats updates
        },
        [mUser?.id, conf, conf.id, mChat, state.watchedChatIds],
        "ChatsGroup:setActiveChats"
    );

    useSafeAsync(
        async () => mUser?.watched ?? null,
        (data: WatchedItems | null) => {
            if (data) {
                dispatchUpdate({
                    action: "setWatchedChatIds",
                    ids: data.watchedChats,
                });
            }
        },
        [mUser?.watchedId],
        "ChatsGroup:setWatchedChatIds"
    );

    useSafeAsync(
        async () => UserProfile.getAll(conf.id),
        data => {
            dispatchUpdate({
                action: "updateAllUsers",
                update: () =>
                    data.map(x => ({
                        id: x.id,
                        name: x.displayName,
                        isBanned: x.isBanned,
                    })),
            });
        },
        [conf.id],
        "ChatsGroup:updateAllUsers"
    );

    // Initial fetch of all chats
    useEffect(() => {
        let cancel: () => void = () => { };

        async function updateChats() {
            try {
                if (mChat) {
                    const chatsP = makeCancelable(mChat.listAllChats());
                    cancel = chatsP.cancel;
                    const chats = await chatsP.promise;
                    dispatchUpdate({
                        action: "updateAllChats",
                        chats,
                    });
                }
            } catch (e) {
                if (!e.isCanceled) {
                    throw e;
                }
            }
        }

        updateChats();

        return cancel;
    }, [mChat]);

    // Update filtered chat results
    useEffect(() => {
        let cancel: () => void = () => { };

        if (mUser) {
            const _mUser = mUser;

            async function updateFiltered() {
                try {
                    const promise = makeCancelable(
                        filterChats(
                            state.allChats ?? [],
                            state.allUsers ?? [],
                            _mUser.id,
                            state.chatSearch,
                            props.minSearchLength
                        )
                    );
                    cancel = promise.cancel;
                    const filteredChats = await promise.promise;
                    const activeChatIds = state.watchedChatIds ?? [];
                    const filteredChatsWithNames: Array<FilteredSidebarChatDescriptor> = await Promise.all(
                        filteredChats.map(async x => (x.exists ? await upgradeChatDescriptor(conf, x, _mUser.id, activeChatIds) : x))
                    );

                    dispatchUpdate({
                        action: "updateFilteredChats",
                        chats: filteredChatsWithNames,
                    });
                } catch (e) {
                    if (!e.isCanceled) {
                        throw e;
                    }
                }
            }

            updateFiltered();
        }

        return cancel;
    }, [conf, conf.id, props.minSearchLength, state.allChats, state.chatSearch, state.allUsers, mUser, state.watchedChatIds]);

    // Subscribe to chat events
    useEffect(() => {
        const listeners: Map<ServiceEventNames, string | null> = new Map();
        // TODO: When creating memberJoinedlisteners handlers get lost and why?
        const memberJoinedlisteners: Map<string, string | null> = new Map();

        if (mChat) {
            const chatService = mChat;
            async function attach() {
                try {
                    listeners.set(
                        "userUpdated",
                        await chatService.serviceEventOn("userUpdated", {
                            componentName: "ChatsGroup",
                            caller: "updateChatDescriptors",
                            function: async u => {
                                if (
                                    u.updateReasons.includes("friendlyName") ||
                                    u.updateReasons.includes("online") ||
                                    u.updateReasons.includes("attributes")
                                ) {
                                    const isOnline = await u.user.isOnline;
                                    function updateDescriptor(x: SidebarChatDescriptor): SidebarChatDescriptor {
                                        if (x.isDM) {
                                            const otherMembers = x.otherMembers.map(member => {
                                                const newMember = { ...member };
                                                if (newMember.profileId === u.user.profileId) {
                                                    newMember.isOnline = isOnline;
                                                }
                                                return newMember;
                                            });
                                            return {
                                                ...x, otherMembers
                                            };
                                        } else {
                                            return x;
                                        }
                                    }

                                    dispatchUpdate({
                                        action: "updateChatDescriptors",
                                        fActive: updateDescriptor,
                                        fFiltered: x => (x.exists ? updateDescriptor(x) : x),
                                    });
                                }
                            },
                        })
                    );
                } catch (e) {
                    if (!e.isCanceled) {
                        throw e;
                    }
                }
            }

            attach();
        }

        return function detach() {
            const keys1 = listeners.keys();
            for (const key of keys1) {
                const listener = listeners.get(key);
                if (listener) {
                    mChat?.serviceEventOff(key, listener);
                }
            }

            const keys2 = memberJoinedlisteners.keys();
            for (const key of keys2) {
                const listener = memberJoinedlisteners.get(key);
                if (listener) {
                    mChat?.channelEventOff(key, "memberJoined", listener);
                }
            }
        };
    }, [conf, logger, mChat]);

    useEffect(() => {
        let f: () => void = () => { };
        if (mChat) {
            f = mChat.chatUnreadCountChangedEvent.sub(ev => {
                dispatchUpdate({
                    action: "updateChatDescriptors",
                    fActive: x => (x.id === ev.chatId ? { ...x, unreadCount: ev.unreadCount } : x),
                    fFiltered: x => (x.exists && x.id === ev.chatId ? { ...x, unreadCount: ev.unreadCount } : x),
                });
            });
        }
        return () => {
            f();
        };
    }, [mChat]);

    const watchedId = mUser?.watchedId;
    const onWatchedItemsUpdated = useCallback(
        function _onWatchedItemsUpdated(update: DataUpdatedEventDetails<"WatchedItems">) {
            for (const object of update.objects) {
                if (object.id === watchedId) {
                    dispatchUpdate({
                        action: "setWatchedChatIds",
                        ids: (object as WatchedItems).watchedChats,
                    });
                }
            }
        },
        [watchedId]
    );

    useDataSubscription("WatchedItems", onWatchedItemsUpdated, null, state.tasks.has("loadingActiveChats"), conf);

    const onTextChatUpdated = useCallback(
        async function _onTextChatUpdated(update: DataUpdatedEventDetails<"TextChat">) {
            if (mUser && mChat) {
                let newAllChats: Array<any> | null = null;
                let newActiveChats: Array<any> | null = null;

                for (const object of update.objects) {
                    const chat = await mChat.getChat(object.id);
                    if (chat) {
                        if (state.watchedChatIds?.includes(chat.id)) {
                            const chatD = await upgradeChatDescriptor(conf, chat, mUser.id, [chat.id]);
                            if (!newActiveChats) {
                                newActiveChats = [];
                            }
                            newActiveChats.push(chatD);
                        }
                        if (!newAllChats) {
                            newAllChats = [];
                        }
                        newAllChats.push(chat);
                    }
                }

                if (newAllChats) {
                    const updates: Array<ChatsGroupUpdate> = [
                        {
                            action: "updateAllChats",
                            chats: newAllChats,
                        },
                    ];

                    if (newActiveChats) {
                        updates.push({
                            action: "updateActiveChats",
                            chats: newActiveChats,
                        });
                    }

                    dispatchUpdate(updates);
                }
            }
        },
        [conf, mChat, mUser, state.watchedChatIds]
    );

    const onTextChatDeleted = useCallback(async function _onTextChatDeleted(
        update: DataDeletedEventDetails<"TextChat">
    ) {
        dispatchUpdate([
            {
                action: "deleteFromAllChats",
                chats: [update.objectId],
            },
            {
                action: "deleteFromActiveChats",
                chats: [update.objectId],
            },
        ]);
    },
        []);

    useDataSubscription("TextChat", onTextChatUpdated, onTextChatDeleted, !state.watchedChatIds, conf);

    const onUserProfileUpdated = useCallback(async function _onUserProfileUpdated(
        update: DataUpdatedEventDetails<"UserProfile">
    ) {
        dispatchUpdate({
            action: "updateAllUsers",
            update: existing => {
                const updated = Array.from(existing ?? []);
                for (const object of update.objects) {
                    const idx = updated?.findIndex(x => x.id === object.id);
                    const profile = object as UserProfile;
                    const item = {
                        id: profile.id,
                        name: profile.displayName,
                        isBanned: profile.isBanned,
                    };
                    if (idx === -1) {
                        updated.push(item);
                    } else {
                        updated.splice(idx, 1, item);
                    }
                }
                return updated;
            },
        });
    },
        []);

    const onUserProfileDeleted = useCallback(async function _onUserProfileDeleted(
        update: DataDeletedEventDetails<"UserProfile">
    ) {
        dispatchUpdate({
            action: "updateAllUsers",
            update: old => old?.filter(x => x.id !== update.objectId) ?? null,
        });
    },
        []);

    useDataSubscription("UserProfile", onUserProfileUpdated, onUserProfileDeleted, !state.allUsers, conf);

    let chatsExpander: JSX.Element = <></>;

    const chatsButtons: Array<ButtonSpec> = [
        {
            type: "search",
            label: "Search all chats",
            icon: "fas fa-search",
            onSearch: event => {
                dispatchUpdate({ action: "searchChats", search: event.target.value });
                return event.target.value;
            },
            onSearchOpen: () => {
                dispatchUpdate({ action: "setIsOpen", isOpen: true });
            },
            onSearchClose: () => {
                dispatchUpdate({ action: "searchChats", search: null });
            },
        },
        { type: "link", label: "View all chats", icon: "fas fa-users", url: "/chat" },
        { type: "link", label: "Create new chat", icon: "fas fa-plus", url: "/chat/new" },
    ];

    if (mUser) {
        let chatEl: JSX.Element;
        const chatSearchValid = state.chatSearch && state.chatSearch.length >= props.minSearchLength;
        if (
            (state.activeChats && state.activeChats.length > 0) ||
            (chatSearchValid && state.allChats && state.filteredChats.length > 0)
        ) {
            let chats: Array<FilteredSidebarChatDescriptor>;
            if (state.chatSearch && state.chatSearch.length >= props.minSearchLength) {
                chats = state.filteredChats;
            } else {
                // We know this can't be null, but TS can't quite figure that out
                chats = state.activeChats as Array<SidebarChatDescriptor>;
            }

            const renderedChats = chats
                .filter(x => !x.exists || (!x.isModeration && !x.isModerationHub))
                .map(chat => {
                    const { friendlyName, icon, unreadCount, isDM } = chat.exists
                        ? computeChatDisplayName(chat, mUser)
                        : {
                            isDM: true,
                            friendlyName: chat.friendlyName,
                            icon: <i className="fas fa-plus" />,
                            unreadCount: undefined,
                        };
                    return {
                        friendlyName,
                        icon,
                        isDM,
                        unreadCount,
                        key: chat.exists ? chat.id : `new-${friendlyName}`,
                        path: chat.exists ? `/chat/${chat.id}` : chat.targetPath,
                    };
                })
                .sort((x, y) => x.friendlyName.localeCompare(y.friendlyName));

            const chatMenuItems: MenuGroupItems = [];
            const showTooltip = randomBackoff(mUser.createdAt, state.randomDeterminant, 6);
            for (const { key, friendlyName, icon, path, unreadCount, isDM } of renderedChats) {
                chatMenuItems.push({
                    key,
                    element: (
                        <MenuItem
                            title={friendlyName + (!!unreadCount ? ` (${unreadCount})` : "")}
                            label={
                                (isDM ? "Direct messages with " : "Group chat: ") +
                                friendlyName +
                                (unreadCount !== undefined ? ` (${unreadCount} unread messages)` : "")
                            }
                            icon={icon}
                            action={path}
                            bold={unreadCount ? unreadCount > 0 : false}
                            onClick={props.onItemClicked}
                            tooltip={showTooltip ? "Hint: You can open multiple chats in separate tabs" : undefined}
                        />
                    ),
                });
            }

            chatEl = <MenuGroup items={chatMenuItems} />;
        } else {
            chatEl = (
                <>
                    {state.allChats && state.activeChats ? <></> : <LoadingSpinner />}
                    <MenuGroup
                        items={[
                            {
                                key: "whole-chat",
                                element: (
                                    <MenuItem
                                        title="View all chats"
                                        label="View all chats"
                                        icon={<i className="fas fa-users"></i>}
                                        action="/chat"
                                        bold={true}
                                        onClick={props.onItemClicked}
                                    />
                                ),
                            },
                        ]}
                    />
                </>
            );
        }

        chatsExpander = (
            <MenuExpander
                title="Chats"
                isOpen={state.isOpen}
                buttons={chatsButtons}
                onOpenStateChange={() => dispatchUpdate({ action: "setIsOpen", isOpen: !state.isOpen })}
                onItemClicked={props.onItemClicked}
            >
                {chatEl}
            </MenuExpander>
        );

        return chatsExpander;
    } else {
        return <></>;
    }
}

import Parse from "parse";
import { Conference, ConferenceConfiguration, TextChat, UserProfile } from "@clowdr-app/clowdr-db-schema";
import IChatManager from "../../IChatManager";
import IChatService from "../../IChatService";
import Channel from "./Channel";
import { default as LocalStorage_TwilioChatToken } from "../../../LocalStorage/TwilioChatToken";
import DebugLogger from "@clowdr-app/clowdr-db-schema/build/DebugLogger";
import assert from "assert";
import * as Twilio from "twilio-chat";
import { Channel as TwilioChannel } from "twilio-chat/lib/channel";
import { User as TwilioUser } from "twilio-chat/lib/user";
import { MemberDescriptor } from "../../Chat";
import { TextChat as TextChatSchema } from "@clowdr-app/clowdr-db-schema/build/DataLayer/Schema";
import { removeNull } from "@clowdr-app/clowdr-db-schema/build/Util";
import { v4 as uuidv4 } from "uuid";

export default class TwilioChatService implements IChatService {
    private twilioToken: string | null = null;
    conference: Conference | null = null;
    private profile: UserProfile | null = null;
    private sessionToken: string | null = null;

    public twilioClient: Promise<Twilio.Client | null> | null = null;

    private _REACT_APP_TWILIO_CALLBACK_URL: string | null = null;

    private logger: DebugLogger = new DebugLogger("TwilioChatService");

    constructor(private manager: IChatManager) {
        // TODO: Remove this line in production
        this.logger.enable();
    }

    async setup(conference: Conference, profile: UserProfile, sessionToken: string) {
        this.conference = conference;
        this.profile = profile;
        this.sessionToken = sessionToken;

        this.twilioClient = new Promise(async (resolve, reject) => {
            let resolved = false;

            try {
                if (!this.twilioToken) {
                    if (LocalStorage_TwilioChatToken.twilioChatToken) {
                        const token = LocalStorage_TwilioChatToken.twilioChatToken;
                        const expiry = LocalStorage_TwilioChatToken.twilioChatTokenExpiry;
                        const confId = LocalStorage_TwilioChatToken.twilioChatTokenConferenceId;
                        const profileId = LocalStorage_TwilioChatToken.twilioChatUserProfileId;
                        this.twilioToken = null;

                        if (confId && token && expiry) {
                            if (confId === conference.id &&
                                profileId === profile.id &&
                                expiry.getTime() >= Date.now()) {
                                this.twilioToken = token;
                                this.logger.info("Twilio token found in local storage (considered valid).");
                            }
                        }

                        if (!this.twilioToken) {
                            this.logger.info("Twilio token found in local storage considered invalid (expired, different conference, or some other issue).");
                        }
                    }
                }

                let retry: boolean;
                let attempCount = 0;

                do {
                    retry = false;
                    attempCount++;

                    if (!this.twilioToken) {
                        const { token, expiry } = await this.fetchFreshToken();
                        if (token) {
                            this.twilioToken = token;
                            LocalStorage_TwilioChatToken.twilioChatToken = token;
                            LocalStorage_TwilioChatToken.twilioChatTokenExpiry = expiry;
                            LocalStorage_TwilioChatToken.twilioChatTokenConferenceId = conference.id;
                            LocalStorage_TwilioChatToken.twilioChatUserProfileId = profile.id;

                            this.logger.info("Twilio token obtained.");
                        }
                        else {
                            this.twilioToken = null;
                            LocalStorage_TwilioChatToken.twilioChatToken = null;
                            LocalStorage_TwilioChatToken.twilioChatTokenExpiry = null;
                            LocalStorage_TwilioChatToken.twilioChatTokenConferenceId = null;
                            LocalStorage_TwilioChatToken.twilioChatUserProfileId = null;

                            this.logger.warn("Twilio token not obtained.");
                            throw new Error("Twilio token not obtained.");
                        }
                    }

                    assert(this.twilioToken);

                    try {
                        // TODO: Increase log level if debugger enabled?
                        this.logger.info("Creating Twilio client...");
                        const result = await Twilio.Client.create(this.twilioToken);
                        resolve(result);
                        resolved = true;
                        this.logger.info("Created Twilio client.");

                        // Ensure we fetched this before the service becomes available
                        await this.get_REACT_APP_TWILIO_CALLBACK_URL()

                        // Enable underlying service features
                        this.enableAutoRenewConnection();
                        this.enableAutoJoinOnInvite();

                        // TODO: Attach to events
                    }
                    catch (e) {
                        if (e.toString().includes("expired")) {
                            this.logger.info("Twilio token (probably) expired.");

                            this.twilioToken = null;

                            if (attempCount < 2) {
                                retry = true;
                            }
                        }

                        if (!retry) {
                            this.logger.error("Could not create Twilio client!", e);
                            throw e;
                        }
                    }
                }
                while (retry);

                if (!resolved) {
                    resolve(null);
                }
            }
            catch (e) {
                if (!resolved) {
                    reject(e);
                }
            }
        });
    }

    async teardown() {
        const client = await this.twilioClient;
        if (client) {
            await client.shutdown();
            this.twilioClient = null;
        }
    }


    private async get_REACT_APP_TWILIO_CALLBACK_URL(): Promise<string> {
        if (!this._REACT_APP_TWILIO_CALLBACK_URL) {
            assert(this.conference);
            const results = await ConferenceConfiguration.getByKey("REACT_APP_TWILIO_CALLBACK_URL", this.conference.id);
            if (results.length > 0) {
                this._REACT_APP_TWILIO_CALLBACK_URL = results[0].value;
            }
            else {
                this.logger.warn("Twilio not configured for this conference.");
                throw new Error("Twilio not configured for this conference.");
            }
        }
        return this._REACT_APP_TWILIO_CALLBACK_URL;
    }

    private async fetchFreshToken(): Promise<{
        token: string | null,
        expiry: Date | null
    }> {
        assert(this.profile);
        assert(this.conference);

        this.logger.info(`Fetching fresh chat token for ${this.profile.displayName} (${this.profile.id}), ${this.conference.name} (${this.conference.id})`);

        const result = await this.requestClowdrTwilioBackend("token");
        return { token: result.token, expiry: new Date(result.expiry) };
    }

    async requestClowdrTwilioBackend(
        endpoint: "token" | "react" | "tcaer",
        data: any = {}
    ) {
        assert(this.sessionToken);
        assert(this.conference);

        data.identity = this.sessionToken;
        data.conference = this.conference.id;

        const callbackUrl = await this.get_REACT_APP_TWILIO_CALLBACK_URL();
        const res = await fetch(
            `${callbackUrl}/chat/${endpoint}`,
            {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        const result = await res.json();
        if (res.status !== 200) {
            throw new Error(result.status);
        }
        return result;
    }

    public async convertTextChatToChannel(tc: TextChat): Promise<Channel> {
        return new Channel(tc, null, this);
    }

    async channels(filterF?: (current: TextChatSchema) => boolean): Promise<Array<Channel>> {
        if (this.conference) {
            const allChats = await (filterF ? TextChat.getChatsMatchingFilter(this.conference.id, filterF) : TextChat.getAll(this.conference.id));
            return removeNull(await Promise.all(allChats.map(async tc => {
                try {
                    // Switching between users + caching may result in some channels
                    // being in the cache that really we're not supposed to have
                    // access to.
                    return await this.convertTextChatToChannel(tc);
                }
                catch {
                    return null;
                }
            })));
        }
        return [];
    }

    async activeChannels(): Promise<Array<Channel>> {
        if (this.profile) {
            const watched = await this.profile.watched;
            const watchedChats = await watched.watchedChatObjects;
            return removeNull(await Promise.all(watchedChats.map(tc => {
                try {
                    return this.convertTextChatToChannel(tc);
                }
                catch {
                    return null;
                }
            })));
        }
        return [];
    }

    async createChannel(invite: Array<string>, isPrivate: boolean, title: string): Promise<Channel> {
        assert(this.conference, "No conference");
        assert(this.profile, "No profile");
        assert(invite.length > 0, "No invites");

        const newTCId: string = await Parse.Cloud.run("textChat-create", {
            name: title,
            conference: this.conference.id,
            isPrivate,
            isDM: isPrivate && invite.length === 1,
            autoWatch: false,
            members: [...invite, this.profile.id]
        });
        return this.getChannel(newTCId);
    }

    async createModerationChannel(invite: Array<string>, relatedModerationKey?: string, initialMessage?: string): Promise<Channel> {
        assert(this.conference, "No conference");
        assert(this.profile, "No profile");

        const newTCId: string = await Parse.Cloud.run("textChat-create", {
            name: `Moderation: ${uuidv4().split("-")[0]}`,
            conference: this.conference.id,
            isModeration: true,
            isPrivate: true,
            isDM: false,
            autoWatch: true,
            members: [...invite, this.profile.id],
            relatedModerationKey,
            initialMessage
        });

        return this.getChannel(newTCId);
    }

    private channelCache: Map<string, Channel> = new Map();
    async getChannel(chatId: string): Promise<Channel> {
        assert(this.conference);
        const tc = await TextChat.get(chatId, this.conference.id);
        if (!tc) {
            throw new Error("Text chat not found.");
        }
        const channelSid = tc.twilioID;

        const cachedChannel = this.channelCache.get(channelSid);
        if (cachedChannel) {
            return cachedChannel;
        }

        const result = new Channel(tc, null, this);
        this.channelCache.set(channelSid, result);
        return result;
    }

    async enableAutoRenewConnection(): Promise<void> {
        this.logger.info("Enabling auto-renew connection.");
        (await this.twilioClient)?.on("tokenAboutToExpire", async () => {
            assert(this.conference);
            assert(this.profile);

            this.logger.info("Token about to expire");

            const { token, expiry } = await this.fetchFreshToken();
            if (token) {
                this.twilioToken = token;
                LocalStorage_TwilioChatToken.twilioChatToken = token;
                LocalStorage_TwilioChatToken.twilioChatTokenExpiry = expiry;
                LocalStorage_TwilioChatToken.twilioChatTokenConferenceId = this.conference.id;
                LocalStorage_TwilioChatToken.twilioChatUserProfileId = this.profile.id;

                this.logger.info("Twilio token for renewal obtained.");

                await (await this.twilioClient)?.updateToken(token);
            }
            else {
                this.twilioToken = null;
                LocalStorage_TwilioChatToken.twilioChatToken = null;
                LocalStorage_TwilioChatToken.twilioChatTokenExpiry = null;
                LocalStorage_TwilioChatToken.twilioChatTokenConferenceId = null;
                LocalStorage_TwilioChatToken.twilioChatUserProfileId = null;

                this.logger.warn("Twilio token for renewal not obtained.");
                throw new Error("Twilio token for renewal not obtained.");
            }
        });
    }

    async enableAutoJoinOnInvite(): Promise<void> {
        this.logger.info("Enabling auto-join on invited.");
        (await this.twilioClient)?.on("channelInvited", async (channel) => {
            channel.join();
        });
    }

    async subscribeToUser(profileId: string) {
        // Causes subscription to the user
        await (await this.twilioClient)?.getUser(profileId);
    }

    async unsubscribeFromUser(profileId: string) {
        const client = await this.twilioClient;
        const subs = await client?.getSubscribedUsers();
        if (subs?.map(x => x.identity).includes(profileId)) {
            const user = await client?.getUser(profileId);
            if (user) {
                await user.unsubscribe();
            }
        }
    }

    private getOnlineStatePromises: Map<string, Promise<boolean | undefined>> = new Map();
    async getIsUserOnline(profileId: string): Promise<boolean | undefined> {
        let p = this.getOnlineStatePromises.get(profileId);
        if (!p) {
            p = new Promise<boolean | undefined>(async (resolve, reject) => {
                try {
                    const client = await this.twilioClient;
                    const d = await client?.getUserDescriptor(profileId);
                    const online = d?.online;
                    resolve(online);
                }
                catch (e) {
                    reject(e);
                }
                finally {
                    this.getOnlineStatePromises.delete(profileId);
                }
            });
            this.getOnlineStatePromises.set(profileId, p);
        }
        return p;
    }

    private listeners: Map<string, Map<string, (arg: any) => void>> = new Map();
    async on<K extends ServiceEventNames>(
        event: K,
        listenerInfo: ((arg: ServiceEventArgs<K>) => void) | {
            componentName: string,
            caller: string,
            function: (arg: ServiceEventArgs<K>) => void
        }
    ): Promise<string> {
        const _this = this;

        let listener: (arg: ServiceEventArgs<K>) => void;
        let listenerId: string;
        let listenerBaseId: string;
        if (typeof listenerInfo === "function") {
            listener = listenerInfo;
            listenerBaseId = uuidv4();
            listenerId = listenerBaseId;
        }
        else {
            listener = listenerInfo.function;
            listenerBaseId = listenerInfo.componentName + "|" + listenerInfo.caller + "|" + event;
            listenerId = listenerBaseId + "|" + uuidv4();
        }

        async function channelWrapper(arg: TwilioChannel) {
            listener(arg.sid as ServiceEventArgs<K>);
        }

        async function userWrapper(arg: {
            user: TwilioUser;
            updateReasons: Array<TwilioUser.UpdateReason>;
        }) {
            assert(_this.conference);
            listener({
                user: {
                    isOnline: Promise.resolve(arg.user.online),
                    profileId: arg.user.identity
                },
                updateReasons: arg.updateReasons
            } as ServiceEventArgs<K>);
        }

        assert(this.twilioClient);
        let _listener: (arg: any) => void = () => { };
        switch (event) {
            case "connectionError":
                _listener = listener;
                break;
            case "connectionStateChanged":
                _listener = listener;
                break;
            case "channelJoined":
                _listener = channelWrapper;
                break;
            case "channelLeft":
                _listener = channelWrapper;
                break;
            case "userUpdated":
                _listener = userWrapper;
                break;

        }

        let listenerMap = this.listeners.get(event);
        if (listenerMap) {
            const existingFKeys
                = Array.from(listenerMap.keys())
                    .filter(x => x.startsWith(listenerBaseId));
            for (const existingFKey of existingFKeys) {
                await this.off(event, existingFKey);
            }
        }
        else {
            listenerMap = new Map();
            this.listeners.set(event, listenerMap);

            const client = await this.twilioClient;
            assert(client);
            client.on(event, (arg) => {
                const map = this.listeners.get(event);
                if (map) {
                    const funcs = map.values();
                    for (const func of funcs) {
                        func(arg);
                    }
                }
            });
        }

        listenerMap.set(listenerId, _listener);

        return _listener as any;
    }

    async off(event: ServiceEventNames, listener: string) {
        if (this.listeners.has(event)) {
            const listenerMap = this.listeners.get(event);
            const listenerF = listenerMap?.get(listener);
            if (listenerF) {
                listenerMap?.delete(listener);
            }
        }
    }
}


export type ServiceEventNames
    = "connectionError"
    | "connectionStateChanged"
    | "channelJoined"
    | "channelLeft"
    | "userUpdated"
    ;

export type ConnectionErrorEventArgs = {
    terminal: boolean;
    message: string;
    httpStatusCode?: number;
    errorCode?: number;
};

type ConnectionStateChangedEventArgs = Twilio.Client.ConnectionState;
type ChannelJoinedEventArgs = string;
type ChannelLeftEventArgs = string;
type UserUpdatedEventArgs = {
    user: MemberDescriptor<Promise<boolean | undefined>>;
    updateReasons: Array<TwilioUser.UpdateReason>
};

export type ServiceEventArgs<K extends ServiceEventNames> =
    K extends "connectionError" ? ConnectionErrorEventArgs
    : K extends "connectionStateChanged" ? ConnectionStateChangedEventArgs
    : K extends "channelJoined" ? ChannelJoinedEventArgs
    : K extends "channelLeft" ? ChannelLeftEventArgs
    : K extends "userUpdated" ? UserUpdatedEventArgs
    : never;

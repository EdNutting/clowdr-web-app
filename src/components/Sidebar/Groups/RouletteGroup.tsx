import React, {useReducer} from 'react';
import MenuExpander, {ButtonSpec} from "../Menu/MenuExpander";
import MenuGroup from '../Menu/MenuGroup';
import MenuItem from '../Menu/MenuItem';

interface Props {
    onItemClicked?: () => void;
}

type RouletteGroupUpdate = { action: "setIsOpen"; isOpen: boolean };

interface RouletteGroupState {
    isOpen: boolean;
}

function nextSidebarState(currentState: RouletteGroupState, updates: RouletteGroupUpdate): RouletteGroupState {
    const nextState: RouletteGroupState = {
        isOpen: currentState.isOpen
    };

    function doUpdate(update: RouletteGroupUpdate) {
        switch (update.action) {
            case "setIsOpen":
                nextState.isOpen = update.isOpen;
                break;
        }
    }

    doUpdate(updates);

    return nextState;
};

export default function RouletteGroup(props: Props) {
    const [state, dispatchUpdate] = useReducer(nextSidebarState, {
        isOpen: true
    });

    let rouletteExpander: JSX.Element = <></>;

    const rouletteButtons: Array<ButtonSpec> = [
        {type: "link", label: "Show all connections", icon: "fas fa-user-friends", url: "/connections"},
        {type: "link", label: "Start new chat", icon: "fas fa-people-arrows", url: "/roulette"}
    ];

    let rouletteEl: JSX.Element = <></>;

    rouletteEl = <>
        <MenuGroup items={[{
            key: "new-chat",
            element: <MenuItem title="Start a new chat" label="New chat" icon={<i className="fas fa-people-arrows"></i>}
                               action="/roulette" bold={true} onClick={props.onItemClicked}/>
        }, {
            key: "all-connections",
            element: <MenuItem title="View all connections" label="All connections"
                               icon={<i className="fas fa-user-friends"></i>}
                               action="/connections" bold={true} onClick={props.onItemClicked}/>,
        }]}/>
    </>;

    rouletteExpander
        = <MenuExpander
        title="Chat Roulette"
        isOpen={state.isOpen}
        buttons={rouletteButtons}
        onOpenStateChange={() => dispatchUpdate({action: "setIsOpen", isOpen: !state.isOpen})}
    >
        {rouletteEl}
    </MenuExpander>;


    return rouletteExpander;
}

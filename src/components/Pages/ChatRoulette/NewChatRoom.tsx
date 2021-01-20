import React, { useState } from "react";
import { Redirect } from "react-router-dom";
import Toggle from "react-toggle";
import useHeading from "../../../hooks/useHeading";
import useMaybeVideo from "../../../hooks/useMaybeVideo";
import AsyncButton from "../../AsyncButton/AsyncButton";
import { addError } from "../../../classes/Notifications/Notifications";
import "./NewChatRoom.scss";
import useUserRoles from "../../../hooks/useUserRoles";
import Parse from "parse"
import { UserProfile } from "@clowdr-app/clowdr-db-schema";


interface Props {
    userProfileId: string;
}

export default function NewChatRoom(props: Props) {
    const mVideo = useMaybeVideo();
    const [newRoomId, setNewRoomId] = useState<string | null>(null);

    const [title, setTitle] = useState<string>("Private Room");
    const [capacity, setCapacity] = useState<number>(10);
    const [isPersistent, setIsPersistent] = useState<boolean>(false);
    const [isPrivate, setIsPrivate] = useState<boolean>(false);
    const { isAdmin, isManager } = useUserRoles();

    useHeading("Ready to start a new roulette?");

    /**
     * Elements that need to be on this page (as a MVP):
     *
     *    * Room title
     *    * Public vs private selector
     *    * Ephemeral selector (forced to true if not an admin/manager)
     */

    // TODO: to be implemented by bingfei
    // async function getRouletteRoom(){
    //     let id = await Parse.Cloud.run("getRouletteRoom");
    //     console.log(id);
    //     return null;
    // }

    async function joinRoulette() {
        let _newRoomId: string | undefined;
        const reply = await Parse.Cloud.run("getRouletteRoom",{
            userId: props.userProfileId,
        });
        if (reply == null){
            _newRoomId = await mVideo?.createRouletteRoom(
                2, true, false, "Chat Roulette " + Date.now(), "roulette");
            console.log(`New room id: ${_newRoomId}`);
        } else {
            _newRoomId = reply
            console.log(`Existing room id: ${_newRoomId}`);
        }
        setNewRoomId(_newRoomId ?? null);
    }

    // const capacityEl : number = 2;
    // const privateEl : boolean = false;
    //
    // const persistentEl : boolean = false;
    // const titleEl : string = "Private room";
    const createButton =
        <AsyncButton action={() => joinRoulette()} children="Ready!" />;

    return newRoomId
        ? <Redirect to={`/roulette/${newRoomId}`} />
        : <div className="new-video-room">
            <form onSubmit={() => joinRoulette()}>
                {/*{capacityEl}<br />*/}
                {/*{titleEl}<br />*/}
                {/*{privateEl}<br />*/}
                {/*{isAdmin || isManager ? <>{persistentEl}<br/></> : <></>}*/}
                <div className="submit-container">
                    {createButton}
                </div>
            </form>
        </div>;
}

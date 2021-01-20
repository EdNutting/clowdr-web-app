import React, { Component, useEffect, useState } from "react";
import { Link, Redirect } from "react-router-dom";
import useHeading from "../../../hooks/useHeading";
import useUserProfile from "../../../hooks/useUserProfile";
import ProfileEditor from "../../Profile/ProfileEditor/ProfileEditor";
import ProfileView from "../../Profile/ProfileView/ProfileView";
import useConference from "../../../hooks/useConference";
import { UserProfile } from "@clowdr-app/clowdr-db-schema";
import { makeCancelable } from "@clowdr-app/clowdr-db-schema/build/Util";
import LocalStorage from "../../../classes/LocalStorage/ProfileEditing";
import Parse from "parse"
import { loadingIndicatorCSS } from "react-select/src/components/indicators";

interface Props {
    userProfileId: string;
}

export default function Connections(props: Props) {

    const [table, setTable] = useState<string[][]>([]);
    const id = props.userProfileId;
    
    useEffect(() => {
        async function getHistory(id:string) {
            let history = await Parse.Cloud.run("getRouletteConnectionHistory",{
                userId: id,
            });

            let userIds = [];
            let table = [];
            let timeMap = new Map();

            for (let i = 0; i < history.length; i++) {
                if (history[i].get("connected")) {
                    let participants = history[i].get("participants");
                    for (let j = 0; j < participants.length; j++) {
                        if (participants[j] !== id) {
                            userIds.push(participants[j]);
                            timeMap[participants[j]] = history[i].get("createdAt");
                        }
                    }  
                }    
            }

            let users = await Parse.Cloud.run("getUserName", {
                userIds: userIds,
            });

            for (let i = 0; i < users.length; i++) {
                table.push([users[i].id, users[i].get("realName"), timeMap[users[i].id]]);
            }

            setTable(table);

        }
        getHistory(id);
    }, [id]);

    console.log(table);

    let tableRows = 
            table!.map((data) => {
                return (
                    <tr>
                        <td key={data[0]}>
                            <Link to={`/profile/${data[0]}`}>{data[1]}</Link>
                        </td>
                        <td key={data[0]}>
                            {data[2].toString()}
                        </td>
                    </tr>
                );
            })


    return <div>
        <h1>Connections</h1>
        <table className="table">
            <tbody>
                {tableRows}
            </tbody>
        </table>
    </div>;
}
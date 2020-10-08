import { makeCancelable } from "@clowdr-app/clowdr-db-schema/build/Util";
import React, { ReactElement, useEffect, useState } from "react";
import { LoadingSpinner } from "../LoadingSpinner/LoadingSpinner";
import "./AsyncButton.scss";

type Handler = () => Promise<void>;

interface Props {
    disabled?: boolean;
    className?: string;
    action?: Handler;
    content?: string;
    setIsRunning?(isRunning: boolean): void;
}

interface Pending {
    state: "pending";
}
interface Running {
    state: "running";
}
interface NotPending {
    state: "notpending";
}
interface Rejected {
    state: "rejected";
}

type ActionState =
    | Pending
    | Running
    | NotPending
    | Rejected;

export default function AsyncButton(props: Props) {

    const [actionState, setActionState] = useState<ActionState>({ state: "notpending" } as NotPending);

    useEffect(() => {
        let cancel: () => void = () => { };

        if (actionState.state === "pending") {
            if (!props.action) {
                setActionState({ state: "notpending" });
                if (props.setIsRunning) {
                    props.setIsRunning(false);
                }
            }
            else {
                setActionState({ state: "running" });

                if (props.setIsRunning) {
                    props.setIsRunning(true);
                }

                const p = makeCancelable(props.action());
                cancel = p.cancel;

                p.promise
                    .then(() => {
                        setActionState({ state: "notpending" });
                        if (props.setIsRunning) {
                            props.setIsRunning(false);
                        }
                    })
                    .catch(error => {
                        if (!error.isCanceled) {
                            setActionState({ state: "rejected" });
                            if (props.setIsRunning) {
                                props.setIsRunning(false);
                            }
                        }
                    });
            }
        }

        return cancel;
    }, [actionState, props]);

    function handleClick(event: React.FormEvent) {
        event.preventDefault();
        event.stopPropagation();

        setActionState({ state: "pending" });
    }

    function getContents(): ReactElement | string | undefined {
        switch (actionState.state) {
            case "pending":
                case "running":
                return <LoadingSpinner message={props.content ?? "Loading"} />;
            case "notpending":
                return props.content;
            case "rejected":
                return "Failed";

        }
    }

    return <button
        disabled={props.disabled || actionState.state !== "notpending"}
        onClick={event => handleClick(event)}
        className={`${actionState.state} ${props.className ?? ""}`}
        type="button">
        {getContents()}
    </button>;
}

import React, { useState, useEffect } from 'react';
import './Page.scss';
import useMaybeConference from '../../hooks/useMaybeConference';
import useMaybeUser from '../../hooks/useMaybeUserProfile';
import useLogger from '../../hooks/useLogger';

interface Props {
}

function Page(props: Props) {
    const conf = useMaybeConference();
    const mUser = useMaybeUser();
    const [title, setTitle] = useState("Please log in to view the conference");
    const [text, setText] = useState("Please log in to view the conference");
    const logger = useLogger("Page");

    useEffect(() => {
        async function updateText() {
            if (conf) {
                setTitle(conf.conferenceName);
                if (mUser) {
                    setText((await conf.loggedInText).value);
                } else {
                    setText(conf.landingPage);
                }
            }
            else {
                setTitle("Welcome to Clowdr");
                setText("Please select a conference");
            }
        };

        updateText().catch(() => {
            logger.info("Logged in text not available - not logged in?");
        });
    });

    return <div className="page"><h1>{title}</h1>{text}</div>;
}

export default Page;

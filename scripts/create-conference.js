// tslint:disable:no-console

const yargs = require('yargs');
const Parse = require("parse/node");
const fs = require('fs');
const path = require('path');
const assert = require("assert");

const argv = yargs
    .option("conference", {
        alias: "c",
        description: "The path to the folder containing the conference spec.",
        type: "string"
    })
    .help()
    .alias("help", "h")
    .argv;

main();

function readConferenceData(rootPath) {
    let conferenceDataStr = fs.readFileSync(path.join(rootPath, "conference.json")).toString();
    let conferenceData = JSON.parse(conferenceDataStr);
    return conferenceData;
}

function readDatas(rootPath, tableName) {
    const fileName = path.join(rootPath, `${tableName}.json`);
    const dataStr = fs.readFileSync(fileName);
    return JSON.parse(dataStr);
}

async function createConference(conferenceData) {
    conferenceData.twilio = {};
    conferenceData.twilio.MASTER_SID = process.env.TWILIO_MASTER_SID;
    conferenceData.twilio.MASTER_AUTH_TOKEN = process.env.TWILIO_MASTER_AUTH_TOKEN;
    conferenceData.twilio.CHAT_PRE_WEBHOOK_URL = process.env.TWILIO_CHAT_PRE_WEBHOOK_URL;
    conferenceData.twilio.CHAT_POST_WEBHOOK_URL = process.env.TWILIO_CHAT_POST_WEBHOOK_URL;
    // data.twilio.removeExisting = true;

    conferenceData.react = {};
    conferenceData.react.TWILIO_CALLBACK_URL = process.env.REACT_APP_TWILIO_CALLBACK_URL;
    conferenceData.react.FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL;

    conferenceData.sendgrid = conferenceData.sendgrid ?? {};
    conferenceData.sendgrid.API_KEY = conferenceData.sendgrid.API_KEY ?? process.env.SENDGRID_API_KEY;
    conferenceData.sendgrid.SENDER = conferenceData.sendgrid.SENDER ?? process.env.SENDGRID_SENDER;

    const createConfJobID = await Parse.Cloud.startJob("conference-create", conferenceData);
    console.log(`Create conference job identity: ${createConfJobID}`);

    let confId = undefined;
    while (true) {
        let jobStatusQ = new Parse.Query("_JobStatus");
        let jobStatusR = await jobStatusQ.get(createConfJobID, { useMasterKey: true });
        if (!jobStatusR) {
            console.error("Could not fetch create conference job status!");
            break;
        }

        let jobStatus = jobStatusR.get("status");
        let message = jobStatusR.get("message");
        if (jobStatus === "failed") {
            throw new Error(`Create conference job failed! Last message before failure: ${message}`)
        }
        else if (jobStatus === "succeeded") {
            confId = message;
            console.log(`Create conference job succeeded. New conference id: ${confId}`);
            break;
        }
    }

    return confId;
}

async function createObjects(confId, adminSessionToken, datas, objectName, keyName) {
    const results = {};
    for (const data of datas) {
        data.conference = confId;
        let finalData = { ...data };
        delete finalData.id;

        console.log(`Creating ${objectName}: ${data[keyName]}`);
        const id = await Parse.Cloud.run(`${objectName}-create`, finalData, {
            sessionToken: adminSessionToken
        });
        results[data[keyName]] = id;
    }
    return results;
}

function remapObjects(sourceMap, targetKey, targetDatas) {
    for (const data of targetDatas) {
        data[targetKey] = sourceMap[data[targetKey]];
    }
}

async function main() {
    const rootPath = argv.conference;

    let conferenceData = readConferenceData(rootPath);

    const attachmentTypesData = readDatas(rootPath, "attachmentTypes");
    const tracksData = readDatas(rootPath, "tracks");
    const personsData = readDatas(rootPath, "persons");
    const itemsData = readDatas(rootPath, "items");
    const itemAttachmentsData = readDatas(rootPath, "itemAttachments");
    const sessionsData = readDatas(rootPath, "sessions");
    const eventsData = readDatas(rootPath, "events");
    const registrationsData = readDatas(rootPath, "registrations");

    const youtubeFeedsData = [];
    const zoomRoomsData = [];
    const contentFeedsData = [];
    function extractFeeds(item) {
        if (item.feed) {
            let content;

            if (item.feed.zoomRoom) {
                let feed = zoomRoomsData.find(x => x.url === item.feed.zoomRoom);
                if (!feed) {
                    feed = {
                        id: zoomRoomsData.length,
                        url: item.feed.zoomRoom
                    };
                    zoomRoomsData.push(feed);
                }
                content = contentFeedsData.find(x => x.zoomRoom === feed.id && x.name === item.feed.name);
                if (!content) {
                    content = {
                        id: contentFeedsData.length,
                        name: item.feed.name,
                        zoomRoom: feed.id
                    };
                    contentFeedsData.push(content);
                }
            }
            else if (item.feed.youtube) {
                let feed = youtubeFeedsData.find(x => x.videoId === item.feed.youtube);
                if (!feed) {
                    feed = {
                        id: youtubeFeedsData.length,
                        videoId: item.feed.youtube
                    };
                    youtubeFeedsData.push(feed);
                }
                content = contentFeedsData.find(x => x.youtube === feed.id && x.name === item.feed.name);
                if (!content) {
                    content = {
                        id: contentFeedsData.length,
                        name: item.feed.name,
                        youtube: feed.id
                    };
                    contentFeedsData.push(content);
                }
            }

            item.feed = content.id;
        }
    }
    tracksData.forEach(extractFeeds);
    itemsData.forEach(extractFeeds);
    sessionsData.forEach(extractFeeds);
    eventsData.forEach(extractFeeds);

    const textChatsData = [];
    // Extract text chats for tracks
    tracksData.forEach(track => {
        if (track.textChat) {
            delete track.textChat;

            const newTextChat = {
                id: textChatsData.length,
                name: `Track: ${track.name}`,
                autoWatch: false
            };
            textChatsData.push(newTextChat);

            const newContentFeed = {
                id: contentFeedsData.length,
                name: newTextChat.name,
                textChat: newTextChat.id
            };
            contentFeedsData.push(newContentFeed);

            track.feed = newContentFeed.id;
        }
    });

    assert(process.env.REACT_APP_PARSE_APP_ID, "REACT_APP_PARSE_APP_ID not provided.");
    assert(process.env.REACT_APP_PARSE_JS_KEY, "REACT_APP_PARSE_JS_KEY not provided.");
    assert(process.env.REACT_APP_PARSE_DATABASE_URL, "REACT_APP_PARSE_DATABASE_URL not provided.");
    assert(process.env.REACT_APP_TWILIO_CALLBACK_URL, "REACT_APP_TWILIO_CALLBACK_URL (Twilio callback (frontend -> clowdr-backend) url) not provided.");
    assert(process.env.REACT_APP_FRONTEND_URL, "REACT_APP_FRONTEND_URL not provided.");

    assert(process.env.TWILIO_MASTER_SID, "TWILIO_MASTER_SID : Twilio master-account SID not provided.");
    assert(process.env.TWILIO_MASTER_AUTH_TOKEN, "TWILIO_MASTER_AUTH_TOKEN : Twilio master-account authentication token not provided.")
    assert(process.env.TWILIO_CHAT_PRE_WEBHOOK_URL, "TWILIO_CHAT_PRE_WEBHOOK_URL : Twilio pre-webhook (Twilio -> clowdr-backend) url not provided.");
    assert(process.env.TWILIO_CHAT_POST_WEBHOOK_URL, "TWILIO_CHAT_POST_WEBHOOK_URL : Twilio post-webhook (Twilio -> clowdr-backend) url not provided.");

    Parse.initialize(process.env.REACT_APP_PARSE_APP_ID, process.env.REACT_APP_PARSE_JS_KEY, process.env.PARSE_MASTER_KEY);
    Parse.serverURL = process.env.REACT_APP_PARSE_DATABASE_URL;

    const confId = await createConference(conferenceData);

    const adminUser = await Parse.User.logIn(conferenceData.admin.username, conferenceData.admin.password);
    const adminSessionToken = adminUser.getSessionToken();

    const youtubeFeeds = await createObjects(confId, adminSessionToken, youtubeFeedsData, "youtubeFeed", "id");
    const zoomRooms = await createObjects(confId, adminSessionToken, zoomRoomsData, "zoomRoom", "id");
    const textChats = await createObjects(confId, adminSessionToken, textChatsData, "textChat", "id");
    remapObjects(youtubeFeeds, "youtube", contentFeedsData);
    remapObjects(zoomRooms, "zoomRoom", contentFeedsData);
    remapObjects(textChats, "textChat", contentFeedsData);
    const contentFeeds = await createObjects(confId, adminSessionToken, contentFeedsData, "contentFeed", "id");
    remapObjects(contentFeeds, "feed", tracksData);
    remapObjects(contentFeeds, "feed", itemsData);
    remapObjects(contentFeeds, "feed", sessionsData);
    remapObjects(contentFeeds, "feed", eventsData);

    const attachmentTypes = await createObjects(confId, adminSessionToken, attachmentTypesData, "attachmentType", "name");
    const tracks = await createObjects(confId, adminSessionToken, tracksData, "track", "name");
    const persons = await createObjects(confId, adminSessionToken, personsData, "person", "name");

    remapObjects(tracks, "track", itemsData);
    itemsData.forEach(item => {
        item.authors = item.authors.map(authorName => persons[authorName]);
    });
    const items = await createObjects(confId, adminSessionToken, itemsData, "item", "title");

    remapObjects(items, "programItem", itemAttachmentsData);
    remapObjects(attachmentTypes, "attachmentType", itemAttachmentsData);
    const itemAttachments = await createObjects(confId, adminSessionToken, itemAttachmentsData, "itemAttachment", "url");

    remapObjects(tracks, "track", sessionsData);
    const sessions = await createObjects(confId, adminSessionToken, sessionsData, "session", "title");

    remapObjects(sessions, "session", eventsData);
    remapObjects(items, "item", eventsData);
    const events = await createObjects(confId, adminSessionToken, eventsData, "event", "startTime");

    const registrations = await createObjects(confId, adminSessionToken, registrationsData, "registration", "name");
}

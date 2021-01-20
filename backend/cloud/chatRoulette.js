/* global Parse */
// ^ for eslint

const { callWithRetry, validateRequest } = require("./utils");
const { isUserInRoles, getRoleByName } = require("./role");
const { getProfileOfUser, getUserProfileById } = require("./user");
const { getConfig } = require("./config");
const { createTextChat } = require("./textChat");
const Twilio = require("twilio");
const { logRequestError } = require("./errors");

async function getRouletteRoom(data) {
    let userId = data.params.userId;
    let id;
    let roomQuery = new Parse.Query("VideoRoom");
    roomQuery.equalTo("mode", "roulette");
    const roomResults = await(await roomQuery.find({ useMasterKey: true })).filter(room => room.get("participants").length === 1);
    if (roomResults.length !== 0) {
        const historyQuery = new Parse.Query("RouletteHistory");
        const historyResult =  await (await historyQuery.find({ useMasterKey: true })).filter(history => history.get("participants").includes(userId));
        let set = new Set();
        for (let i = 0; i < historyResult.length; i++) {
            set.add(historyResult[i].get("participants")[0]);
            set.add(historyResult[i].get("participants")[1]);
        }
        for (let i = 0; i < roomResults.length; i++) {
            if (!set.has(roomResults[i].get("participants")[0])) {
                id = roomResults[i].id;
                let newObject = new Parse.Object("RouletteHistory", {
                    conference: roomResults[i].get("conference"),
                    participants: [roomResults[i].get("participants")[0],userId],
                    rouletteRoomId: id,
                    connected: null,
                });
                await newObject.save(null, { useMasterKey: true });
                break;
            }
        }
    }
    return id;
}

Parse.Cloud.define("getRouletteRoom", getRouletteRoom);

async function updateRouletteConnectionHistory(data){
    let historyQuery = new Parse.Query("RouletteHistory");
    historyQuery.equalTo("rouletteRoomId", data.params.roomId);
    const historyResults = await historyQuery.first({ useMasterKey: true });
    let curState = historyResults.get("connected");
    let newState = curState==null?false:true;
    historyResults.set("connected", newState);
    await historyResults.save(null, { useMasterKey: true });
}
Parse.Cloud.define("updateRouletteConnectionHistory", updateRouletteConnectionHistory);

async function getRouletteConnectionHistory(data){
    let userId = data.params.userId;
    let historyQuery = new Parse.Query("RouletteHistory");
    const historyResults =  await (await historyQuery.find({ useMasterKey: true })).filter(history => history.get("participants").includes(userId));
    return historyResults;
}
Parse.Cloud.define("getRouletteConnectionHistory", getRouletteConnectionHistory);

async function getUserName(data){
    let userIds = data.params.userIds;
    let userProfileQuery = new Parse.Query("UserProfile");
    const userProfileResults =  await userProfileQuery.containedIn("objectId", userIds).find({ useMasterKey: true });
    return userProfileResults;
}
Parse.Cloud.define("getUserName", getUserName);

module.exports = {
    updateRouletteConnectionHistory
};
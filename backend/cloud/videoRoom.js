/* global Parse */
// ^ for eslint

const { callWithRetry, validateRequest } = require("./utils");
const { isUserInRoles, getRoleByName } = require("./role");
const { getProfileOfUser, getUserProfileById } = require("./user");
const { getConfig } = require("./config");
const { createTextChat } = require("./textChat");
const Twilio = require("twilio");
const { logRequestError } = require("./errors");
const {updateRouletteConnectionHistory} = require("./chatRoulette");

// Video rooms are created in Twilio only when they are first needed.
// So they are created when a user requests an access token for a room -
// accounting for whether that room already exists or has expired in Twilio.
//
// This is why below, we create video rooms in Parse but don't allocate them
// a video room inside Twilio.
//
// This is in stark contrast to Twilio Text Chats, where we allocate those
// immediately inside Twilio - partly because they are persistent.

// **** Video Room **** //

async function getRoomById(roomId, confId) {
    const q = new Parse.Query("VideoRoom");
    q.equalTo("conference", new Parse.Object("Conference", { id: confId }));
    return await q.get(roomId, { useMasterKey: true });
}

Parse.Cloud.beforeDelete("VideoRoom", async (request) => {
    // Don't prevent deleting stuff just because of an error
    //   If things get deleted in the wrong order, the conference may even be missing
    try {
        const room = request.object;
        const conference = room.get("conference");

        // For some dumb reason, just fetching the text chat directly doesn't work...
        const textChat = await new Parse.Query("TextChat").get(room.get("textChat").id, { useMasterKey: true });

        await new Parse.Query("ContentFeed")
            .equalTo("conference", conference)
            .map(async feed => {
                let save = false;
                const feedRoom = feed.get("videoRoom");
                const feedChat = feed.get("textChat");
                if (feedRoom && feedRoom.id === room.id) {
                    feed.unset("videoRoom");
                    save = true;
                }
                if (textChat && feedChat && feedChat.id === textChat.id) {
                    feed.unset("textChat");
                    save = true;
                }
                if (save) {
                    await feed.save(null, { useMasterKey: true });
                }
            }, { useMasterKey: true });

        if (textChat && !textChat.get("isDM") && textChat.get("mode") === "ordinary") {
            await textChat.destroy({ useMasterKey: true });
        }
    
        await new Parse.Query("WatchedItems")
            .equalTo("conference", conference)
            .map(async watched => {
                const watchedIds = watched.get("watchedRooms");
                watched.set("watchedRooms", watchedIds.filter(x => x !== room.id));
                await watched.save(null, { useMasterKey: true });
            }, { useMasterKey: true });

        const twilioID = room.get("twilioID");
        if (twilioID) {
            const config = await getConfig(conference.id);
            const accountSID = config.TWILIO_ACCOUNT_SID;
            const accountAuth = config.TWILIO_AUTH_TOKEN;
            const twilioClient = Twilio(accountSID, accountAuth);
            try {
                await callWithRetry(() => twilioClient.video.rooms(twilioID).update({
                    status: "completed"
                }));
            }
            catch (e) {
                if (!(e.toString().includes("resource") && e.toString().includes("not found"))) {
                    await logRequestError(request, 0, "beforeDelete:VideoRoom:mark-completed", e);
                    throw e;
                }
            }
        }
    }
    catch (e) {
        await logRequestError(request, 0, "beforeDelete:VideoRoom", e);
        console.error(`Error deleting video room! ${e}`);
    }
});

/**
 * @typedef {Object} VideoRoomSpec
 * @property {number} capacity
 * @property {boolean} ephemeral
 * @property {boolean} isPrivate
 * @property {string} name
 * @property {string | undefined} [twilioID]
 * @property {Pointer} conference
 * @property {Pointer | undefined} [textChat]
 */

const createVideoRoomSchema = {
    capacity: "number",
    ephemeral: "boolean",
    isPrivate: "boolean",
    name: "string",
    twilioID: "string?",
    conference: "string",
    textChat: "string?",
};

const createRouletteRoomSchema = {
    capacity: "number",
    ephemeral: "boolean",
    isPrivate: "boolean",
    name: "string",
    twilioID: "string?",
    conference: "string",
    textChat: "string?",
    mode: "string",
};
/**
 * Creates a Video Room.
 *
 * Note: You must perform authentication prior to calling this.
 *
 * @param {VideoRoomSpec} data - The specification of the new Video Room.
 * @returns {Promise<Parse.Object>} - The new Video Room
 */
async function createVideoRoom(data, user) {
    const newObject = new Parse.Object("VideoRoom", data);

    const confId = newObject.get("conference").id;
    const adminRole = await getRoleByName(confId, "admin");
    const managerRole = await getRoleByName(confId, "manager");
    const attendeeRole = await getRoleByName(confId, "attendee");

    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setWriteAccess(user, true);
    if (data.isPrivate) {
        acl.setReadAccess(user, true);
    }
    else {
        acl.setRoleReadAccess(attendeeRole, true);
    }
    acl.setRoleReadAccess(managerRole, true);
    acl.setRoleWriteAccess(managerRole, true);
    acl.setRoleReadAccess(adminRole, true);
    acl.setRoleWriteAccess(adminRole, true);
    newObject.setACL(acl);

    await newObject.save(null, { useMasterKey: true });
    return newObject;
}

/**
 * @param {Parse.Cloud.FunctionRequest} req
 */
async function handleCreateVideoRoom(req) {
    const { params, user } = req;

    const requestValidation = validateRequest(createVideoRoomSchema, params);
    if (requestValidation.ok) {
        const confId = params.conference;

        const authorized = !!user && await isUserInRoles(user.id, confId, ["admin", "manager", "attendee"]);
        if (authorized) {
            const profile = await getProfileOfUser(user, confId);

            const spec = params;
            spec.conference = new Parse.Object("Conference", { id: confId });
            // Prevent non-admin/manager from creating persistent rooms
            // Prevent non-admin/manager from creating large rooms
            if (!await isUserInRoles(user.id, confId, ["admin", "manager"])) {
                spec.ephemeral = true;
                spec.capacity = 10;
            }
            // Clamp capacity down to Twilio max size
            spec.capacity = Math.min(spec.capacity, 50);

            if (!spec.textChat) {
                spec.textChat = await createTextChat({
                    autoWatch: false,
                    name: spec.name,
                    conference: spec.conference,
                    creator: profile,
                    mirrored: false,
                    isDM: false,
                    isPrivate: spec.isPrivate,
                    mode: "ordinary",
                    members: [profile.id]
                });
            }
            else {
                spec.textChat = new Parse.Object("TextChat", { id: spec.textChat });
            }

            const result = await createVideoRoom(spec, user);
            return result.id;
        }
        else {
            throw new Error("Permission denied");
        }
    }
    else {
        throw new Error(requestValidation.error);
    }
}

Parse.Cloud.define("videoRoom-create", handleCreateVideoRoom);

async function handleCreateRouletteRoom(req) {
    const { params, user } = req;

    const requestValidation = validateRequest(createRouletteRoomSchema, params);
    if (requestValidation.ok) {
        const confId = params.conference;

        const authorized = !!user && await isUserInRoles(user.id, confId, ["admin", "manager", "attendee"]);
        if (authorized) {
            const profile = await getProfileOfUser(user, confId);

            const spec = params;
            spec.conference = new Parse.Object("Conference", { id: confId });
            // Prevent non-admin/manager from creating persistent rooms
            // Prevent non-admin/manager from creating large rooms
            if (!await isUserInRoles(user.id, confId, ["admin", "manager"])) {
                spec.ephemeral = true;
                spec.capacity = 10;
            }
            // Clamp capacity down to Twilio max size
            spec.capacity = Math.min(spec.capacity, 50);

            if (!spec.textChat) {
                spec.textChat = await createTextChat({
                    autoWatch: false,
                    name: spec.name,
                    conference: spec.conference,
                    creator: profile,
                    mirrored: false,
                    isDM: false,
                    isPrivate: spec.isPrivate,
                    mode: "ordinary",
                    members: [profile.id]
                });
            }
            else {
                spec.textChat = new Parse.Object("TextChat", { id: spec.textChat });
            }

            const result = await createVideoRoom(spec, user);
            return result.id;
        }
        else {
            throw new Error("Permission denied");
        }
    }
    else {
        throw new Error(requestValidation.error);
    }
}

Parse.Cloud.define("rouletteRoom-create", handleCreateRouletteRoom);

/**
 * Gives a user access (ACL) for a video room.
 * 
 * Does nothing if the room is not private.
 * 
 * @param {Parse.Object} room - Video room to modify
 * @param {Parse.User} user - User to grant access
 * @param {boolean} write - Whether to grant write-access or not
 * @param {string} sessionToken - Current user's session token
 */
async function grantAccessToVideoRoom(room, userProfile, write, sessionToken) {
    if (!room.get("isPrivate")) {
        // Public room, nothing to do.
        return;
    }

    const user = userProfile.get("user");
    const acl = room.getACL();
    acl.setReadAccess(user, true);
    if (write) {
        acl.setWriteAccess(user, true);
    }
    room.setACL(acl);
    await room.save(null, { sessionToken: sessionToken });

    let tc = room.get("textChat");
    if (tc) {
        tc = await tc.fetch({ sessionToken: sessionToken });
        const tcACL = tc.getACL();
        tcACL.setReadAccess(user, true);
        if (write) {
            tcACL.setWriteAccess(user, true);
        }
        tc.setACL(tcACL);
        // We have to force the write here because text chats get created/configured differently to video rooms
        await tc.save(null, { useMasterKey: true });
    }
}

const inviteToVideoRoomSchema = {
    conference: "string",
    room: "string",
    users: "[string]",
    write: "boolean"
};

/**
 * @param {Parse.Cloud.FunctionRequest} req
 */
async function handleInviteToVideoRoom(req) {
    const { params, user } = req;

    const requestValidation = validateRequest(inviteToVideoRoomSchema, params);
    if (requestValidation.ok) {
        const confId = params.conference;
        const roomId = params.room;

        const room = await getRoomById(roomId, confId);
        const results = {};
        for (const userId of params.users) {
            const targetUserProfile = await getUserProfileById(userId, confId);
            let succeeded = false;
            if (targetUserProfile) {
                try {
                    await grantAccessToVideoRoom(room, targetUserProfile, params.write, user.getSessionToken());
                    succeeded = true;
                }
                catch (e) {
                    succeeded = false;
                }
            }
            results[userId] = succeeded;
        }
        return results;
    }
    else {
        throw new Error(requestValidation.error);
    }
}
Parse.Cloud.define("videoRoom-invite", handleInviteToVideoRoom);

module.exports = {
    createVideoRoom

};

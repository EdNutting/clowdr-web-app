import { Base } from ".";
import { Conference, Flair, UserPresence, ProgramPerson, BreakoutRoom, _User } from "../Interface";

// This is embedded in UserProfile and is not itself a table in the DB
export interface UserProfileTag {
    alwaysShow: boolean;
    label: string;
    priority: number;
    tooltip: string;
}

export default interface Schema extends Base {
    affiliation: string;
    bio: string;
    country: string;
    displayName: string;
    position: string;
    profilePhoto: Parse.File | null;
    pronouns: string;
    realName: string;
    tags: Array<UserProfileTag>;
    webpage: string
    welcomeModalShown: boolean;

    conference: Promise<Conference>;
    primaryFlair: Promise<Flair>;
    presence: Promise<UserPresence>;
    programPersons: Promise<Array<ProgramPerson>>;
    user: Promise<_User>;
    watchedRooms: Promise<Array<BreakoutRoom>>;
}

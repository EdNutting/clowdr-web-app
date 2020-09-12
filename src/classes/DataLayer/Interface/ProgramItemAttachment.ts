import * as Schema from "../Schema";
import { CachedBase, StaticCachedBase, StaticBaseImpl, PromisesRemapped, FieldDataT } from "./Base";
import { ProgramItem, AttachmentType } from ".";

type SchemaT = Schema.ProgramItemAttachment;
type K = "ProgramItemAttachment";
const K_str: K = "ProgramItemAttachment";

export default class Class extends CachedBase<K> implements SchemaT {
    constructor(
        conferenceId: string,
        data: FieldDataT[K],
        parse: Parse.Object<PromisesRemapped<SchemaT>> | null = null) {
        super(conferenceId, K_str, data, parse);
    }

    get file(): Parse.File {
        return this.data.file;
    }

    get url(): string {
        return this.data.url;
    }

    get programItem(): Promise<ProgramItem> {
        return this.uniqueRelated("programItem");
    }

    get attachmentType(): Promise<AttachmentType> {
        return this.uniqueRelated("attachmentType");
    }


    static get(id: string, conferenceId: string): Promise<Class | null> {
        return StaticBaseImpl.get(K_str, id, conferenceId);
    }

    static getAll(conferenceId: string): Promise<Array<Class>> {
        return StaticBaseImpl.getAll(K_str, conferenceId);
    }
}

// The line of code below triggers type-checking of Class for static members
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _: StaticCachedBase<K> = Class;
import React, {useState} from 'react';
import {Alert, Button, Form, Input, message, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Upload} from "antd";
import {DeleteOutlined, EditOutlined, UploadOutlined, SaveTwoTone, CloseCircleTwoTone} from '@ant-design/icons';
import Parse from "parse";
import {AuthUserContext} from "../../../Session";

const {Option} = Select;

const {TabPane} = Tabs;
const IconText = ({icon, text}) => (
    <Space>
        {React.createElement(icon)}
        {text}
    </Space>
);

const liveRoomSources = ['YouTube', 'Twitch', 'Facebook', 'iQIYI', 'ZoomUS', 'ZoomCN'];

class Rooms extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            editing: false,
            edt_room: undefined,
            searched: false,
            searchResult: "",
            alert: ""
        };
    }

    onCreate(values) {
        var _this = this;
        // Create the Room record
        var Room = Parse.Object.extend("ProgramRoom");
        var room = new Room();
        room.set("name", values.name);
        room.set("src1", values.src1);
        room.set("id1", values.id1);
        room.set("pwd1", values.pwd1);
        room.set("src2", values.src2);
        room.set("id2", values.id2);
        room.set("pwd2", values.pwd2);
        room.set("qa", values.qa);
        room.set("conference", this.props.auth.currentConference);
        room.save().then((val) => {
            _this.setState({visible: false, ProgramRooms: [room, ...this.state.ProgramRooms]})
        }).catch(err => {
            console.log(err);
        });
    }

    onDelete(value) {
        console.log("Deleting " + value + " " + value.get("name"));
        // Delete the watchers first

        value.destroy();
    }

    onEdit(room) {
        console.log("Editing " + room.get("name") + " " + room.id);
        this.setState({
            visible: true,
            editing: true,
            edt_room: {
                objectId: room.id,
                name: room.get("name"),
                src1: room.get("src1"),
                pwd1: room.get("pwd1"),
                id1: room.get("id1"),
                src2: room.get("src2"),
                id2: room.get("id2"),
                pwd2: room.get("pwd2"),
                qa: room.get("qa"),
            }
        });
    }

    onUpdate(values) {
        var _this = this;
        console.log("Updating " + values.id1 + "; " + values.objectId);
        let room = this.state.ProgramRooms.find(r => r.id == values.objectId);

        if (room) {
            room.set("name", values.name);
            room.set("src1", values.src1);
            room.set("id1", values.id1);
            room.set("pwd1", values.pwd1);
            room.set("src2", values.src2);
            room.set("id2", values.id2);
            room.set("pwd2", values.pwd2);
            room.set("qa", values.qa);
            room.save().then((val) => {
                _this.setState({visible: false, editing: false});
            }).catch(err => {
                console.log(err + ": " + values.objectId);
            })
        } else {
            console.log("room not found: " + values.id1);
        }
    }

    setVisible() {
        this.setState({'visible': !this.state.visible});
    }

    async componentDidMount() {
        let rooms = await this.props.auth.programCache.getProgramRooms(this);
        this.setState({ProgramRooms: rooms, loading: false})
    }

    onChange(info) {
        console.log("onChange " + info.file.status);
        if (info.file.status !== 'uploading') {
            console.log(info.file, info.fileList);
        }
        if (info.file.status === 'done') {
            message.success(`${info.file.name} file uploaded successfully`);
        } else if (info.file.status === 'error') {
            message.error(`${info.file.name} file upload failed.`);
        }
    }


    beforeUpload(file, fileList) {
        const reader = new FileReader();
        reader.onload = () => {
            const data = {content: reader.result, conference: this.props.auth.currentConference.id};
            Parse.Cloud.run("rooms-upload", data).then(() => this.refreshList());
        }
        reader.readAsText(file);
        return false;
    }

    componentWillUnmount() {
        this.props.auth.programCache.cancelSubscription("ProgramRoom", this);
    }

    render() {
        const {Option} = Select;

        function onChange(value) {
            console.log(`selected ${value}`);
        }

        function onBlur() {
            console.log('blur');
        }

        function onFocus() {
            console.log('focus');
        }

        function onSearch(val) {
            console.log('search:', val);
        }

        // set up editable cell
        const EditableCell = ({editing, dataIndex, title, inputType, record, index, children, ...restProps}) => {
            let inputNode = null;
            switch (dataIndex) {
                case ('name'):
                    inputNode = <Input placeholder="Name"/>;
                    break;
                case ('src1'):
                    inputNode = (
                        <Select
                            showSearch
                            placeholder="Select a Main Channel"
                            optionFilterProp="children"
                            onChange={onChange}
                            onFocus={onFocus}
                            onBlur={onBlur}
                            onSearch={onSearch}
                            filterOption={(input, option) =>
                                option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                            }
                        >
                            {liveRoomSources.map(src => {
                                return (
                                    <Option value={src} key={src}>{src}</Option>
                                );
                            })}

                        </Select>
                    );
                    break;
                case ('id1'):
                    inputNode = <Input style={{width: '100%'}} type="textarea" placeholder="ID"/>
                    break;
                case ('pwd1'):
                    inputNode =
                        <Input style={{width: '100%'}} type="password" placeholder="Encrypted Password (Optional)"/>
                    break;
                case ('src2'):
                    inputNode = (
                        <Select
                            showSearch
                            placeholder="Select an Alt Channel"
                            optionFilterProp="children"
                            onChange={onChange}
                            onFocus={onFocus}
                            onBlur={onBlur}
                            onSearch={onSearch}
                            filterOption={(input, option) =>
                                option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                            }
                        >
                            {liveRoomSources.map(src => {
                                return (
                                    <Option value={src} key={src}>{src}</Option>
                                );
                            })}

                        </Select>
                    );
                    break;
                case ('id2'):
                    inputNode = <Input style={{width: '100%'}} type="textarea" placeholder="ID"/>
                    break;
                case ('pwd2'):
                    inputNode =
                        <Input style={{width: '100%'}} type="password" placeholder="Encrypted Password (Optional)"/>
                    break;
                case ('qa'):
                    inputNode = <Input placeholder="Q&A tool link"/>
                    break;
                default:
                    inputNode = null;
                    break;
            }
            return (
                <td {...restProps}>
                    {editing ? (
                        <Form.Item
                            name={dataIndex}
                            style={{margin: 0,}}
                            rules={dataIndex !== "name" ? [] : [
                                {
                                    required: true,
                                    message: `Please Input ${title}!`,
                                },
                            ]}
                        >
                            {inputNode}
                        </Form.Item>
                    ) : (
                        children
                    )}
                </td>
            );
        };

        // set up editable table
        const EditableTable = () => {
            console.log("Loading Editable table");
            const [form] = Form.useForm();
            const [data, setData] = useState(this.state.ProgramRooms);
            const [editingKey, setEditingKey] = useState('');

            const isEditing = record => record.id === editingKey;

            const edit = record => {

                form.setFieldsValue({
                    name: record.get("name") ? record.get("name") : "",
                    src1: record.get("src1") ? record.get("src1") : "",
                    id1: record.get("id1") ? record.get("id1") : "",
                    pwd1: record.get("pwd1") ? record.get("pwd1") : "",
                    src2: record.get("src2") ? record.get("src2") : "",
                    id2: record.get("id2") ? record.get("id2") : "",
                    pwd2: record.get("pwd2") ? record.get("pwd2") : "",
                    qa: record.get("qa") ? record.get("qa") : ""
                });
                console.log("setting editing key state", record.id);
                setEditingKey(record.id);
                console.log("editing key state done");
            };

            const cancel = () => {
                setEditingKey('');
            };

            const onDelete = record => {
                console.log("deleting item: " + record.get("title"));
                const newRooms = [...this.state.ProgramRooms];
                this.setState({
                    ProgramRooms: newRooms.filter(item => item.id !== record.id)
                });
                // delete from database
                let data = {
                    clazz: "ProgramRoom",
                    conference: {clazz: "ClowdrInstance", id: record.get("conference").id},
                    id: record.id
                }
                Parse.Cloud.run("delete-obj", data)
                .then(c => this.setState({alert: "delete success"}))
                .catch(err => {
                    this.setState({alert: "delete error"})
                    this.refreshList();
                    console.log("[Admin/Rooms]: Unable to delete: " + err)
                })

            };

            const save = async id => {
                console.log("Entering save func");
                try {
                    const row = await form.validateFields();
                    const newData = [...data];
                    let room = newData.find(item => item.id === id);

                    if (room) {
                        console.log("row is : " + row.title);

                        let data = {
                            clazz: "ProgramRoom",
                            conference: {clazz: "ClowdrInstance", id: room.get("conference").id},
                            id: room.id,
                            name: row.name,
                            src1: row.src1,
                            id1: row.id1,
                            src2: row.src2,
                            id2: row.id1,
                            qa: row.qa
                        }
                        console.log(data)
                        Parse.Cloud.run("update-obj", data)
                        .then(c => this.setState({alert: "save success"}))
                        .catch(err => {
                            this.setState({alert: "save error"})
                            console.log("[Admin/Rooms]: Unable to save: " + err)
                        })

                        setEditingKey('');
                    } else {
                        newData.push(row);
                        setData(newData);
                        setEditingKey('');
                    }
                } catch (errInfo) {
                    console.log('Validate Failed:', errInfo);
                }
            };

            const columns = [
                {
                    title: 'Name',
                    dataIndex: 'name',
                    key: 'name',
                    width: '10%',
                    editable: true,
                    defaultSortOrder: 'ascend',
                    sorter: (a, b) => {
                        var nameA = a.get("name") ? a.get("name") : "";
                        var nameB = b.get("name") ? b.get("name") : "";
                        return nameA.localeCompare(nameB);
                    },
                    render: (text, record) => <span>{record.get("name")}</span>,
                },
                {
                    title: 'Main Media Source',
                    dataIndex: 'src1',
                    width: '15%',
                    editable: true,
                    sorter: (a, b) => {
                        var srcA = a.get("src1") ? a.get("src1") : "";
                        var srcB = b.get("src1") ? b.get("src1") : "";
                        return srcA.localeCompare(srcB);
                    },
                    render: (text, record) => <span>{record.get("src1")}</span>,
                    key: 'roomsrc1',
                },
                {
                    title: 'Media ID',
                    dataIndex: 'id1',
                    width: '10%',
                    editable: true,
                    render: (text, record) => <span>{record.get("id1")}</span>,
                    key: 'roomid1',
                },
                {
                    title: 'Password',
                    dataIndex: 'pwd1',
                    width: '10%',
                    editable: true,
                    render: (text, record) => <span>{record.get("pwd1")}</span>,
                    key: 'pwd1',
                },
                {
                    title: 'Alt Media Source',
                    dataIndex: 'src2',
                    width: '15%',
                    editable: true,
                    sorter: (a, b) => {
                        var srcA = a.get("src2") ? a.get("src2") : "";
                        var srcB = b.get("src2") ? b.get("src2") : "";
                        return srcA.localeCompare(srcB);
                    },
                    render: (text, record) => <span>{record.get("src2")}</span>,
                    key: 'roomsrc2',
                },
                {
                    title: 'Alt Media ID',
                    dataIndex: 'id2',
                    width: '10%',
                    editable: true,
                    render: (text, record) => <span>{record.get("id2")}</span>,
                    key: 'roomid2',
                },
                {
                    title: 'Password',
                    dataIndex: 'pwd2',
                    width: '10%',
                    editable: true,
                    render: (text, record) => <span>{record.get("pwd2")}</span>,
                    key: 'pwd2',
                },
                {
                    title: 'Q&A',
                    dataIndex: 'qa',
                    width: '20%',
                    editable: true,
                    render: (text, record) => <span>{record.get("qa")}</span>,
                    key: 'qa',
                },
                {
                    title: 'Action',
                    dataIndex: 'action',
                    render: (_, record) => {
                        const editable = isEditing(record);
                        if (this.state.ProgramRooms.length > 0) {
                            return editable ?
                                (
                                    <span>
                                        <a onClick={() => save(record.id)}
                                           style={{marginRight: 8}}>
                                            {<SaveTwoTone />}
                                        </a>
                                        <Popconfirm title="Sure to cancel?" onConfirm={cancel}>
                                            <a>{<CloseCircleTwoTone />}</a>
                                        </Popconfirm>
                                    </span>
                                )
                                : (
                                    <Space size='small'>
                                        <a title="Edit" disabled={editingKey !== ''} onClick={() => edit(record)}>
                                            {<EditOutlined/>}
                                        </a>
                                        <Popconfirm
                                            title="Are you sure delete this session?"
                                            onConfirm={() => onDelete(record)}
                                            okText="Yes"
                                            cancelText="No"
                                        >
                                            <a title="Delete">{<DeleteOutlined/>}</a>
                                        </Popconfirm>
                                    </Space>
                                )
                        } else {
                            return null;
                        }

                    }
                }
            ];

            const mergedColumns = columns.map(col => {
                if (!col.editable) {
                    return col;
                }

                return {
                    ...col,
                    onCell: record => ({
                        record,
                        inputType: 'text',
                        dataIndex: col.dataIndex,
                        title: col.title,
                        editing: isEditing(record),
                    }),
                };
            });

            return (
                <Form form={form} component={false}>
                    <Table
                        components={{
                            body: {
                                cell: EditableCell,
                            },
                        }}
                        bordered
                        dataSource={this.state.searched ? this.state.searchResult : this.state.ProgramRooms}
                        columns={mergedColumns}
                        rowClassName="editable-row"
                        rowKey='id'
                        pagination={{
                            onChange: cancel,
                        }}
                    />
                </Form>
            );
        }

        // handle when a new item is added
        const handleAdd = () => {
            let data = {
                clazz: "ProgramRoom",
                conference: {clazz: "ClowdrInstance", id: this.props.auth.currentConference.id},
                name: "Please enter the name of the room",
            }

            Parse.Cloud.run("create-obj", data)
            .then(t => console.log("[Admin/Rooms]: sent new object to cloud"))
            .catch(err => {
                this.setState({alert: "add error"})
                console.log("[Admin/Rooms]: Unable to create: " + err)
            })
        };

        if (this.state.loading)
            return (
                <Spin tip="Loading...">
                </Spin>
            );

        else return (
            <div>
                {this.state.alert.length > 0 ? (
                    <Alert
                        onClose={() => this.setState({alert: ""})}
                        message={this.state.alert}
                        type={this.state.alert.includes("success") ? "success" : "error"}
                        showIcon
                        closable
                    />
                ) : null}
                <table style={{width: "100%"}}>
                    <tbody>
                    <tr>
                        <td>
                            <Upload accept=".txt, .csv" onChange={this.onChange.bind(this)}
                                    beforeUpload={this.beforeUpload.bind(this)}>
                                <Button>
                                    <UploadOutlined/> Upload file
                                </Button>
                            </Upload>
                        </td>

                        <td width='100%'>
                            <Input.Search
                                allowClear
                                placeholder="Search by name"
                                onSearch={key => {
                                    if (key == "") {
                                        this.setState({searched: false});
                                    } else {
                                        this.setState({searched: true});
                                        this.setState({
                                            searchResult: this.state.ProgramRooms.filter(
                                                room => (room.get('name') && room.get('name').toLowerCase().includes(key.toLowerCase()))
                                            )
                                        });
                                    }
                                }}
                            />
                        </td>

                        <td>
                            <Button
                                type="primary"
                                onClick={handleAdd}
                            >
                                New Room
                            </Button>

                        </td>
                    </tr>

                    </tbody>
                </table>

                <EditableTable/>
            </div>
        );
    }

}

const AuthConsumer = (props) => (
            <AuthUserContext.Consumer>
                {value => (
                    <Rooms {...props} auth={value}  />
                )}
            </AuthUserContext.Consumer>

);

export default AuthConsumer;

const CollectionEditForm = ({title, visible, data, onAction, onCancel, onSelectPullDown1, onSelectPullDown2, socialSpaces, socialSpacesLoading}) => {
    const [form] = Form.useForm();
    return (
        <Modal
            visible={visible}
            title={title}
            // okText="Create"
            footer={[
                <Button form="myForm" key="submit" type="primary" htmlType="submit">
                    Submit
                </Button>
            ]}
            cancelText="Cancel"
            onCancel={onCancel}
        >
            <Form
                form={form}
                layout="vertical"
                name="form_in_modal"
                id="myForm"
                initialValues={{
                    modifier: 'public',
                    ...data
                }}
                onFinish={() => {
                    form
                        .validateFields()
                        .then(values => {
                            form.resetFields();
                            onAction(values);
                        })
                        .catch(info => {
                            console.log('Validate Failed:', info);
                        });
                }}
            >
                <Form.Item name="objectId" noStyle>
                    <Input type="text" type="hidden"/>
                </Form.Item>
                <Form.Item
                    name="name"
                    rules={[
                        {
                            required: true,
                            message: 'Please input the name of the room!',
                        },
                    ]}
                >
                    <Input placeholder="Name"/>
                </Form.Item>
                <Form.Item name="stream1">
                    <Input.Group compact>
                        <Form.Item name="src1">
                            <Select placeholder="Main Source" style={{width: 120}} onChange={onSelectPullDown1}>
                                {liveRoomSources.map(src => (
                                    <Option key={src}>{src}</Option>
                                ))}
                            </Select>
                        </Form.Item>
                        <Form.Item name="id1">
                            <Input style={{width: '100%'}} type="textarea" placeholder="ID"/>
                        </Form.Item>
                        <Form.Item name="pwd1">
                            <Input style={{width: '100%'}} type="textarea" placeholder="Encrypted Password (Optional)"/>
                        </Form.Item>
                    </Input.Group>
                </Form.Item>
                <Form.Item name="stream2">
                    <Input.Group compact>
                        <Form.Item name="src2">
                            <Select placeholder="Alt. Source" style={{width: 120}} onChange={onSelectPullDown2}>
                                {liveRoomSources.map(src => (
                                    <Option key={src}>{src}</Option>
                                ))}
                            </Select>
                        </Form.Item>
                        <Form.Item name="id2" rules={[
                            {
                                required: false
                            },
                        ]}>
                            <Input style={{width: '100%'}} type="textarea" placeholder="ID"/>
                        </Form.Item>
                        <Form.Item name="pwd2">
                            <Input style={{width: '100%'}} type="textarea" placeholder="Encrypted Password (Optional)"/>
                        </Form.Item>
                    </Input.Group>
                </Form.Item>
                <Form.Item name="qa">
                    <Input placeholder="Q&A tool link"/>
                </Form.Item>
            </Form>
        </Modal>
    );
};
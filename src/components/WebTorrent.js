import P2P from 'socket.io-p2p';
import io from 'socket.io-client';

import React from 'react';
import ReactDOM from 'react-dom';

import _ from 'lodash';
import uuid from 'uuid';

export default class App extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      files: [],
      mySocketId: '',
      username: '',
      userEnterLeaveMessage: {},
      formErrorMessage: '',
    };
  }

  componentWillMount() {
    this.socket = io();
    this.opts = { peerOpts: { trickle: false }, autoUpgrade: false };
    this.p2psocket = new P2P(this.socket, this.opts);
    this.p2psocket.on('get-socket-id', this.onGetSocketId);
    this.p2psocket.on('user-list', this.onUserList);
    this.p2psocket.on('new-user', this.onNewUser);
    this.p2psocket.on('disconnect-user', this.onDisconnectUser);
    this.p2psocket.on('file-data', this.onFileData);
    this.p2psocket.on('new-file-name', this.onNewFileName);
    this.p2psocket.on('new-file-description', this.onNewFileDescription);
    this.p2psocket.on('give-file-back', this.onGiveFileBack);
    this.p2psocket.on('peer-file', this.onPeerFile);
  }

  // File p2p transition methods

  onNewFileName = (data) => {
    const fileObject = this.state.files.find(file => file.fileId === data.fileId);
    this.setState({
      files: [
        ...this.state.files.filter(file => file.fileId !== data.fileId),
        Object.assign(fileObject, {
          suggestedFileName: data.newFileName,
        }),
      ],
    });
  };

  onNewFileDescription = (data) => {
    const fileObject = this.state.files.find(file => file.fileId === data.fileId);
    this.setState({
      files: [
        ...this.state.files.filter(file => file.fileId !== data.fileId),
        Object.assign(fileObject, {
          fileDescription: data.newFileDescription,
        }),
      ],
    });
  };

  onFileSubmit = (e) => {
    e.preventDefault();
    const suggestedFileNameInput = this.refs.suggestedFileName;
    const fileDescriptionInput = this.refs.fileDescription;
    const fileInput = this.refs.fileInput;
    if (fileInput.value !== '' &&
      suggestedFileNameInput.value !== '' &&
      fileDescriptionInput.value !== ''
    ) {
      const file = fileInput.files[0];
      const fileId = uuid.v1();
      const fileName = file.name;
      const fileSize = file.size;
      const fileType = file.type;
      this.p2psocket.emit('file-data', {
        file,
        fileId,
        fileName,
        suggestedFileName: suggestedFileNameInput.value,
        fileDescription: fileDescriptionInput.value,
        fileSize,
        fileType,
        seederSocketId: this.state.mySocketId,
        uploadedBy: this.state.username,
        uploadedAt: new Date().toLocaleTimeString('en-GB'),
      });

      this.setState({
        formErrorMessage: '',
      });

      fileInput.value = '';
      suggestedFileNameInput.value = '';
      fileDescriptionInput.value = '';
    } else {
      this.setState({
        formErrorMessage: 'All fields are required!',
      });
    }
  };

  onFileData = (data) => {
    this.setState({
      files: [
        ...this.state.files,
        Object.assign({}, {
          ...data,
          ownFile: this.state.mySocketId === data.seederSocketId &&
            data.uploadedBy === this.state.username ? true : false,
          fileProgressValue: 0,
          currentlyEditingName: false,
          currentlyEditingDescription: false,
          chunkFileSize: 0,
          fileBuffer: [],
          fileLeechers: [],
        }),
      ],
    });
  };

  onDownload = (seederSocketId, leecherSocketId, requestedFileId) => {
    const leecherUsername = this.state.username;
    const fileObject =
      this.state.files.find(file => file.fileId === requestedFileId);
    if (fileObject.fileUrl) {
      this.refs[requestedFileId].click();
    } else {
      this.p2psocket.emit('ask-for-file', {
        seederSocketId,
        leecherSocketId,
        leecherUsername,
        requestedFileId,
      });
    }
  };

  onGiveFileBack = (data) => {
    let requestedFileObject = this.state.files.find(file => file.fileId === data.requestedFileId);
    const file = new window.Blob([requestedFileObject.file]);
    const fileSize = requestedFileObject.fileSize;

    var chunkSize = 198384;
    var sliceFile = offset => {
      var reader = new window.FileReader();
      reader.onload = (() => evnt => {
        this.p2psocket.emit('peer-file', {
          file: evnt.target.result,
          fileLeecher: data.leecherSocketId,
          requestedFileObject,
        });
        if (file.size > offset + evnt.target.result.byteLength) {
          window.setTimeout(sliceFile, 0, offset + chunkSize);
        }

        this.setState({
          files: [
            Object.assign(requestedFileObject, {
              fileProgressValue: offset + evnt.target.result.byteLength,
            }),
            ...this.state.files.filter(file => file.fileId !== requestedFileObject.fileId),
          ],
        });

        if (requestedFileObject.fileProgressValue === requestedFileObject.fileSize) {
          this.setState({
            files: [
              Object.assign(requestedFileObject, {
                fileProgressValue: 0,
              }),
              ...this.state.files.filter(file => file.fileId !== requestedFileObject.fileId),
            ],
          });
        }
      })(file);

      reader.onerror = err => {
        console.error('Error while reading file', err);
      };

      var slice = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    let leechers = requestedFileObject.fileLeechers;
    leechers.push(data.leecherUsername);

    this.setState({
      files: [
        Object.assign(requestedFileObject, {
          fileLeechers: leechers,
        }),
        ...this.state.files.filter(file => file.fileId !== requestedFileObject.fileId),
      ],
    });

    sliceFile(0);
  };

  onPeerFile = (data) => {
    const fileObject =
      this.state.files.find(file => file.fileId === data.requestedFileObject.fileId);
    this.setState({
      files: [
        Object.assign(fileObject, {
          fileBuffer: [
            ...fileObject.fileBuffer,
            data.file,
          ],
          chunkFileSize: fileObject.chunkFileSize + data.file.byteLength,
          fileProgressValue: fileObject.fileProgressValue + data.file.byteLength,
        }),
        ...this.state.files.filter(file => file.fileId !== data.requestedFileObject.fileId),
      ],
    });

    if (fileObject.chunkFileSize === fileObject.fileSize) {
      const blob = new window.Blob(fileObject.fileBuffer);
      const urlCreator = window.URL || window.webkitURL;
      const fileUrl = urlCreator.createObjectURL(blob);

      this.setState({
        files: [
          Object.assign(fileObject, {
            fileUrl,
            fileBuffer: [],
            chunkFileSize: 0,
            fileProgressValue: 0,
          }),
          ...this.state.files.filter(file => file.fileId !== fileObject.fileId),
        ],
      });

      this.refs[data.requestedFileObject.fileId].click();
    }
  };

  // User actions

  onGetSocketId = (socketId) => {
    this.setState({
      mySocketId: socketId,
    });
  };

  onUsername = (e) => {
    e.preventDefault();
    if (this.refs.username.value !== '') {
      this.setState({
        username: this.refs.username.value,
      });

      this.p2psocket.emit('new-user',
      {
        username: this.refs.username.value,
        socketId: this.state.mySocketId,
      });

      this.refs.username.value = '';
    }
  };

  onUserList = (userList) => {
    this.setState({
      userList,
    });
  };

  onNewUser = (data) => {
    this.setState({
      userList: data.userList,
    });
    if (data.newUser && data.self !== this.state.mySocketId) {
      this.setState({
        userEnterLeaveMessage: {
          message: data.newUser + ' has entered WebTorrent!',
          messageColor: 'green',
        },
      });
    }
  };

  onDisconnectUser = (data) => {
    this.setState({
      userList: data.userList,
    });
    if (data.disconnectedUser) {
      this.setState({
        userEnterLeaveMessage: {
          message: data.disconnectedUser + ' has left WebTorrent :(',
          messageColor: 'red',
        },
      });
    }
  };

  // On file edit actions

  onEditFileName = (socketId, fileId) => {
    const fileObject = this.state.files.find(file => file.fileId === fileId);
    this.setState({
      files: [
        ...this.state.files.filter(file => file.fileId !== fileId),
        Object.assign(fileObject, {
          currentlyEditingName: true,
        }),
      ],
    });
  };

  onEditFileDescription = (socketId, fileId) => {
    const fileObject = this.state.files.find(file => file.fileId === fileId);
    this.setState({
      files: [
        ...this.state.files.filter(file => file.fileId !== fileId),
        Object.assign(fileObject, {
          currentlyEditingDescription: true,
        }),
      ],
    });
  };

  onEditFileSave = (socketId, fileId) => {
    const fileObject = this.state.files.find(file => file.fileId === fileId);
    if (fileObject.currentlyEditingName) {
      const newFileName = this.refs.newFileName.value ?
        this.refs.newFileName.value :
          fileObject.suggestedFileName;

      this.p2psocket.emit('new-file-name', { newFileName, fileId });

      this.setState({
        files: [
          ...this.state.files.filter(file => file.fileId !== fileId),
          Object.assign(fileObject, {
            suggestedFileName: newFileName,
            currentlyEditingName: false,
            currentlyEditingDescription: false,
          }),
        ],
      });
    } else if (fileObject.currentlyEditingDescription) {
      const newFileDescription = this.refs.newFileDescription.value ?
        this.refs.newFileDescription.value :
          fileObject.fileDescription;

      this.p2psocket.emit('new-file-description', { newFileDescription, fileId });

      this.setState({
        files: [
          ...this.state.files.filter(file => file.fileId !== fileId),
          Object.assign(fileObject, {
            fileDescription: newFileDescription,
            currentlyEditingDescription: false,
          }),
        ],
      });
    }
  };

  // Helper methods

  roundFileSize = (fileSize) => {
    let BYTEtoKB = Number(fileSize / 1024);
    let roundedSize = _.round(BYTEtoKB, 1);
    let withKB = roundedSize + ' KBs';
    return withKB;
  };

  getFileType = fileType => {
    let fileTypeArray =  _.split(fileType, '/', 2);
    return _.head(fileTypeArray);
  };

  getFileExtension = fileType => _.split(fileType, '/', 2).pop();

  render() {
    const userList = _.map(this.state.userList, (user, i) => (
      <li key={i}>
        {user.username}
      </li>
    ));
    const sortedLinks = _.orderBy(this.state.files, ['uploadedAt'], ['desc']);
    const links = _.map(sortedLinks, (file, i) => (
      <li key={i}>
        {file.ownFile ? <h5 style={{ color: 'green' }}>This is your own file</h5> : null }
        {
          !file.currentlyEditingName ?
            <p><b>File Name:</b> {file.suggestedFileName}</p> :
              <p>
                <b>New File Name: </b>
                <input type="text" autoFocus
                  ref="newFileName" defaultValue={file.suggestedFileName}/>
              </p>
        }
        {
          !file.currentlyEditingDescription ?
            <p><b>File Description:</b> {file.fileDescription}</p> :
              <p>
                <b>New Description: </b>
                <input type="text" autoFocus
                  ref="newFileDescription" defaultValue={file.fileDescription}/>
              </p>
        }
        <p><b>Original File Name: </b>{file.fileName}</p>
        <p><b>File Size: </b>{this.roundFileSize(file.fileSize)}</p>
        <p><b>Uploaded By: </b>{file.uploadedBy}</p>
        <p><b>Uploaded At: </b>{file.uploadedAt}</p>
        <p><b>File Type: </b>{this.getFileType(file.fileType)}</p>
        <p><b>File Extension: </b>{this.getFileExtension(file.fileType)}</p>
        <progress value={file.fileProgressValue} max={file.fileSize} />
        <br/>
        {
          !file.ownFile ?
            <button
              className="btn"
              onClick={this.onDownload.bind(
                this,
                file.seederSocketId,
                this.state.mySocketId,
                file.fileId
            )}>
              Download
            </button> :
              !file.currentlyEditingName && !file.currentlyEditingDescription ?
                <div>
                  {
                    file.fileLeechers ?
                      file.fileLeechers.map((leecher, i) => (
                        <h5 key={i}>
                          <span style={{ color: 'purple' }}>{leecher} </span>
                          downloading/downloaded your file
                        </h5>
                      )) :
                      null
                  }
                  <button
                    onClick={this.onEditFileName.bind(
                      this,
                      this.state.mySocketId,
                      file.fileId
                  )}
                    className="btn action-button">
                    Edit Name
                  </button>
                  <button
                    onClick={this.onEditFileDescription.bind(
                      this,
                      this.state.mySocketId,
                      file.fileId
                  )}
                    className="btn action-button">
                    Edit Description
                  </button>
                </div> :
                  <button
                    onClick={this.onEditFileSave.bind(
                      this,
                      this.state.mySocketId,
                      file.fileId
                  )}
                    className="btn action-button">
                    Save
                  </button>
        }
        <a style={{ display: 'none' }}
          download={file.suggestedFileName + '.' + this.getFileExtension(file.fileType)}
          ref={file.fileId}
          href={file.fileUrl}></a>
        <hr />
      </li>
    ));
    return (
      this.state.username ?
        <div className="container">
          <div className="row">
            <h1 className="title">WebTorrent</h1>
            <div className="col-md-6 col-sm-6 col-xs-6">
              <form onSubmit={this.onFileSubmit}>
                <div className="form-group">
                  <label forHTML="suggestedFileName">Enter file name: </label>
                  <input className="form-control"
                    type="text" id="suggestedFileName"
                    ref="suggestedFileName" placeholder="Suggested Name" />
                </div>
                <div className="form-group">
                  <label forHTML="fileDescription">Enter file description: </label>
                  <textarea className="form-control"
                    id="fileDescription" rows="5"
                    ref="fileDescription" placeholder="File Description"/>
                </div>
                <div className="form-group">
                  <label forHTML="fileName">Select file to send: </label>
                  <input type="file" id="fileName"
                    ref="fileInput" size="40" onChange={this.onFileChange} />
                </div>
                <input className="btn btn-default" type="submit" value="Send" />
              </form>
              {
                this.state.formErrorMessage ?
                  <div className="alert alert-danger">
                    <h5 style={{ color: 'red' }}>{this.state.formErrorMessage}</h5>
                  </div> :
                  null
              }
            </div>
            <div className="col-md-6 col-sm-6 col-xs-6">
              <div className="pull-right">
                <h5>Who is online?</h5>
                {
                  this.state.userEnterLeaveMessage ?
                    <h6 style={{ color: this.state.userEnterLeaveMessage.messageColor }}>
                      {this.state.userEnterLeaveMessage.message}
                    </h6> :
                    null
                }
                <ul>
                  {userList}
                </ul>
              </div>
            </div>
          </div>
          <div className="row">
            <h3>Download Files from other Peers:</h3>
            <hr/>
            <div className="col-md-6 col-sm-6 col-xs-6">
              {
                this.state.files.length ?
                <ul>{links}</ul> :
                  <h4>
                    There are no files here yet <span className="glyphicon glyphicon-floppy-save" />
                  </h4>
              }
            </div>
            <div className="col-md-6 col-sm-6 col-xs-6"></div>
          </div>
        </div> :
          <div className="row">
            <div className="col-md-4 col-sm-6 col-xs-6 col-md-offset-3 col-sm-offset-3 col-xs-offset-3">
              <div style={{ marginTop: '150px' }}>
                <h1 style={{ color: 'green' }}>Welcome to Torrent!</h1>
                <form onSubmit={this.onUsername}>
                  <div className="form-group">
                    <label forHTML="username">Enter your Username: </label>
                    <input className="form-control"
                      type="text" id="username"
                      ref="username" placeholder="Your Name" />
                  </div>
                  <input type="submit" className="btn btn-default" value="Enter" />
                </form>
              </div>
            </div>
          </div>
    );
  }
}

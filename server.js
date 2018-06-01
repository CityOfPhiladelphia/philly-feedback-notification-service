// global.XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Constants
var loginAttemps = 3;

// Global requires
const express = require('express');
var cors = require('cors')
const formt = require('util').format;
const multer  = require('multer')
const bodyParser = require('body-parser');
const Storage = require('@google-cloud/storage');
const AWS = require('aws-sdk');

require.extensions['.txt'] = function (module, filename) {
  module.exports = fs.readFileSync(filename, 'utf8');
};

// Load env constants
require('dotenv').config();

// Load file system library
const fs = require('fs');
const Mustache = require('mustache');

// Let's configure the logger
const winston = require('winston');

const logFormat = winston.format.printf(function(info) {
  const date = new Date();
  return `${date.toISOString()}-${info.level}: ${JSON.stringify(info.message, null, 4)}\n`;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.colorize(), logFormat),
  transports: [
    new winston.transports.File({
      filename: 'error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'combined.log'
    }),
  ]
});

// Set the region 
var credentials = new AWS.SharedIniFileCredentials({profile: 'alejandro.lopez'});
AWS.config.credentials = credentials;
AWS.config.update({region: 'us-east-1'});

// Setup Firebase
const firebase = require('firebase');
require("firebase/firestore");

const config = {
  apiKey: 'AIzaSyDiK1pFLSQL2KfZlcOMLzmBBw7kOlioI4k',
  authDomain: 'philly-feedback.firebaseapp.com',
  databaseURL: 'https://philly-feedback.firebaseio.com',
  projectId: 'philly-feedback',
  storageBucket: 'philly-feedback.appspot.com',
  messagingSenderId: '761632853920'
};

let firebaseApp = null;
if (!firebase.apps.length) {
  firebaseApp = firebase.initializeApp(config);
} else {
  firebaseApp = firebase.apps[0];
}

const firebaseDatabase = firebaseApp.firestore();
var $emails = String(process.env.EMAILS).split(',');
firebaseDatabase.collection('emails')
.onSnapshot(snapshot => {
  $emails = new Array();
  snapshot.forEach(doc => {
    $emails.push(doc.data().email);
  });
});

// Email config
const params = {
  Destination: { /* required */
    ToAddresses: []
  },
  Message: { /* required */
    Body: { /* required */
      Html: {
        Charset: "UTF-8",
      },
      Text: {
        Charset: "UTF-8",
      }
    },
    Subject: {
      Charset: 'UTF-8'
    }
  },
  Source: 'alejandro.lopez@phila.gov', /* required */
  ReplyToAddresses: [],
};

const HTML_TEMPLATE = require("./html_template.txt");
const TEXT_TEMPLATE = require("./text_template.txt");

function sentErrorMessage(situation, error, kill) {
  // Set the log
  let message = `Feedback Notification App Error: Please check the logs. \n ${situation}`;
  message += `Error: \n ${JSON.stringify(error, null, 4)}`;

  // Send notification
  params.Message.Body.Html.Data = message;;
  params.Message.Body.Text.Data = params.Message.Body.Html.Data;
  params.Message.Subject.Data = 'Feedback App error';
  params.Destination.ToAddresses = ['alejandro.lopez@phila.gov'];
  new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params, () => {
    if (kill) {
      process.exit(1);
    }
  });

  logger.error(error.stack);
}

function killService() {
  sentErrorMessage('Service Killed, please check logs.', null, true);
}

// Save data on firebase
function saveDataOnFirebase(req, res, next, fileURL) {
  const now = new Date().toISOString();
  fileURL = fileURL || '';
  const dataToSend = {
    name: req.body['pf-name'],
    email: req.body['pf-email'],
    consentToContact: (req.body['pf-consent']) ? true : false,
    feedback: req.body['pf-feedback'],
    pageTitle: req.body['pf-pageTitle'],
    image: fileURL,
    href: req.body['pf-href'],
    origin: req.body['pf-origin'],
    datetime: now,
    metadata: JSON.parse(req.body['pf-metadata'])
  };

  try {
    firebaseDatabase.collection("feedbacks").doc(`${now}`).set(dataToSend)
    .then(function() {
      logger.info(`${Date().toISOString()}: Sending Email to ${$emails.join(',')}`);

      params.Destination.ToAddresses = $emails;
      params.ReplyToAddresses = $emails;

      // SEND EMAIL
      params.Message.Subject.Data = 'We\'ve got a new feedback!';
      params.Message.Body.Html.Data = Mustache.render(HTML_TEMPLATE, dataToSend);
      params.Message.Body.Text.Data = Mustache.render(TEXT_TEMPLATE, dataToSend);

      new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params).promise()
      .then(function(email_response) {
        console.log("Cool, everythig is alright");
      })
      .catch(function(error) {
        sentErrorMessage(`There was an error sending the email for feedback ${dataToSend.datetime}`, error);
      });
      // -- SEND EMAIL

      res.status(200).send('Great! looks good...');
    })
    .catch(function(err) {
      sentErrorMessage('Error saving the user feedback, Firebase Catch', err);
      res.status(400).send('There was an error saving the data, please try again');
    });
  } catch(err) {
    sentErrorMessage('Error saving the user feedback, Javascript Catch', err);
    res.status(400).send('There was an error saving the data, please try again');
  }
}

function execMainStuff() {
  let whitelist = new Array();

  // firebaseDatabase.collection('access-control')
  //   .onSnapshot(snapshot => {
  //     whitelist = new Array();
  //     snapshot.forEach(doc => {
  //         whitelist.push(doc.data().origin);
  //     });
  //   });

  var corsOptionsDelegate = function (req, callback) {
    let corsOptions;
    let error = null;
    corsOptions = { origin: true }; // reflect (enable) the requested origin in the CORS response
    // if (whitelist.indexOf(req.header('Origin')) !== -1) {
    //   corsOptions = { origin: true }; // reflect (enable) the requested origin in the CORS response
    //   error = null;
    // }else{
    //   logger.info(`${req.header('Origin')} is not allowed`);
    //   corsOptions = { origin: false }; // disable CORS for this request
    //   error = new Error('Not allowed by CORS');
    // }
    callback(error, corsOptions) // callback expects two parameters: error and options 
  }

  // Setup server
  const app = express();

  app.use(bodyParser.json());

  app.use(cors(corsOptionsDelegate));

  // Setting multer upload
  const upload = multer({
    limits: {
      fileSize: 2 * 1024 * 1024
    },
    storage: multer.memoryStorage()
  });

  app.use(upload.single('pf-image'));

  app.use(function (err, req, res, next) {
    sentErrorMessage('Something broke on the feedback notification', err);
    res.status(500).send('Oops something broke!')
  })

  const storage = Storage();
  const bucket = storage.bucket(process.env.GCLOUD_STORAGE_BUCKET);

  app.get('/', function (req, res, next) {
    res.status(200).send('Oops, there is nothing here...');
  })

  app.post('/', function (req, res, next) {
    if (!req.file) {
      saveDataOnFirebase(req, res, next);
      return;
    }

    try {
      const blob = bucket.file(Date.now() + req.file.originalname);
      const blobStream = blob.createWriteStream();

      blobStream.on('error', (err) => {
        sentErrorMessage('Error uploading a file for an user', err);
        res.status(400).send('The image was not uploade, please verify the requirements');
        return;
      });

      blobStream.on('finish', () => {
        // The public URL can be used to directly access the file via HTTP.
        blob.makePublic();
        const publicUrl = formt(`https://storage.googleapis.com/${bucket.name}/${blob.name}`);
        saveDataOnFirebase(req, res, next, publicUrl);
      });

      blobStream.end(req.file.buffer);
    } catch (err) {
      sentErrorMessage('Error uploading a file for an user', err);
      res.status(400).send('There was an error uploading the file, please verify the requirements');
    }
  });

  var port = process.env.PORT || 3000;

  app.listen(port, function() {
    console.log('Listening on ' + port);
  });
}

function doLogin() {
  firebaseApp.auth().signInWithEmailAndPassword(process.env.EMAIL, process.env.PASS).catch((error) => {
    sentErrorMessage(`Feedback Notification App, login error.!`, error);
  });
}

firebaseApp.auth().onAuthStateChanged(function(user) {
  if (user) {
    execMainStuff();
  } else {
    if ( loginAttemps > 0 ) {
      doLogin();
    } else {
      killService();
    }
  }
});

doLogin();
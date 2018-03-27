var loginAttemps = 3;
var restartAttemps = 4;
var SENT = new Array();

require.extensions['.txt'] = function (module, filename) {
  module.exports = fs.readFileSync(filename, 'utf8');
};

// Load env constants
require('dotenv').config();

// Load file system library
const fs = require('fs');
const Mustache = require('mustache');

// Load Firebase
const Firebase = require('firebase');
require("firebase/firestore");

// Load AWS SDK
const AWS = require('aws-sdk');

// Load a Logger
const {transports, createLogger, format} = require('winston');
const logger = createLogger({
  level: 'info',
  format: format.combine(
      format.timestamp(),
      format.json()
  ),
  transports: [
    //
    // - Write to all logs with level `info` and below to `combined.log` 
    // - Write all logs error (and below) to `error.log`.
    //
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' })
  ]
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
// 
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.simple()
  }));
}

// Set the region 
var credentials = new AWS.SharedIniFileCredentials({profile: 'alejandro.lopez'});
AWS.config.credentials = credentials;
AWS.config.update({region: 'us-east-1'});


const config = {
  apiKey: 'AIzaSyDiK1pFLSQL2KfZlcOMLzmBBw7kOlioI4k',
  authDomain: 'philly-feedback.firebaseapp.com',
  databaseURL: 'https://philly-feedback.firebaseio.com',
  projectId: 'philly-feedback',
  storageBucket: 'philly-feedback.appspot.com',
  messagingSenderId: '761632853920'
};

let firebaseApp = null;
if (!Firebase.apps.length) {
  firebaseApp = Firebase.initializeApp(config);
} else {
  firebaseApp = Firebase.apps[0];
}

const firestore = firebaseApp.firestore();

// Mail params
const params = {
  Destination: { /* required */
    ToAddresses: [
      'alejandro.lopez@phila.gov',
      /* more To email addresses */
    ]
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
  ReplyToAddresses: [
      'alejandro.lopez@phila.gov',
  ],
};

const HTML_TEMPLATE = require("./html_template.txt");
const TEXT_TEMPLATE = require("./text_template.txt");

function sentErrorMessage(situation, error, kill) {
  // Set the log
  const message = `Feedback Notification App Error: Please check the logs. \n ${situation}`;
  logger.error(message, error);

  // Send notification
  params.Message.Body.Html.Data = message;;
  params.Message.Body.Text.Data = params.Message.Body.Html.Data;
  params.Message.Subject.Data = 'Oops! notification app error';
  params.Destination.ToAddresses = ['alejandro.lopez@phila.gov'];
  new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params, () => {
    if (kill) process.exit(1);
  });
}

function killService() {
  sentErrorMessage('Service Killed, please check logs.', null, true);
}

// Try to sign-in
function doLogin() {
  loginAttemps--;
  firebaseApp.auth().signInWithEmailAndPassword(process.env.EMAIL, process.env.PASS).catch((error) => {
    sentErrorMessage(`Feedback Notification App, login error.!`, error);
  });
}

function execMainStuff() {
  if (SENT.length >= 100) SENT = new Array();

  restartAttemps--;
  if (restartAttemps <= 0) {
    killService();
  }

  const unsubscribe = firestore.collection('feedbacks').where('notified', '==', false)
    .onSnapshot(querySnapshot => {

      var numOfValues = querySnapshot.size;
      if (!querySnapshot.empty) unsubscribe();
      querySnapshot.forEach(function (doc) {
        const data = doc.data();

        if ( SENT[doc.id] !== true ) {
          SENT[doc.id] = true;

          params.Message.Subject.Data = 'We\'ve got a new feedback!';
          params.Message.Body.Html.Data = Mustache.render(HTML_TEMPLATE, data);
          params.Message.Body.Text.Data = Mustache.render(TEXT_TEMPLATE, data);

          new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params).promise()
          .then(function(email_response) {
            console.log("Cool, everythig is alright");
          })
          .catch(function(error) {
            sentErrorMessage(`There was an error sending the email for feedback ${doc.id}`, error);
          });
        }

        firestore.collection('feedbacks').doc(doc.id).set({
          notified: true
        }, { merge: true })
        .then(() => {
          numOfValues--;
          if(numOfValues <= 0) {
            restartAttemps = 3;
            execMainStuff();
          }
        });
      });
      
    }, error => {
      sentErrorMessage(`Getting un-notified feedbacks`, error);
      execMainStuff();
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

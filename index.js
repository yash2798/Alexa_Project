// This is template files for developing Alexa skills

'use strict';

var winston = require('winston');
var https = require('https');
var Promise = require('bluebird');
var bcrypt = require('bcryptjs');
var aws = require('aws-sdk');
aws.config.update({
  region: "us-east-1" 
});
var docClient = new aws.DynamoDB.DocumentClient();

var logger = new (winston.Logger)({
    transports: [
      new (winston.transports.Console)({ prettyPrint: true, timestamp: true, json: false, stderrLevels:['error']})
    ]
  });

var intentHandlers = {};

if(process.env.NODE_DEBUG_EN) {
  logger.level = 'debug';
}


exports.handler = function (event, context) {
    try {

        logger.info('event.session.application.applicationId=' + event.session.application.applicationId);

        if (APP_ID !== '' && event.session.application.applicationId !== APP_ID) {
            context.fail('Invalid Application ID');
         }

        if (!event.session.attributes) {
            event.session.attributes = {};
        }

        logger.debug('Incoming request:\n', JSON.stringify(event,null,2));

        if (event.session.new) {
            onSessionStarted({requestId: event.request.requestId}, event.session);
        }


        if (event.request.type === 'LaunchRequest') {
            onLaunch(event.request, event.session, new Response(context,event.session));
        } 
        else if (event.request.type === 'IntentRequest') {
            var response =  new Response(context,event.session);
            if (event.request.intent.name in intentHandlers) {
              intentHandlers[event.request.intent.name](event.request, event.session, response,getSlots(event.request));
            } else {
              response.speechText = 'Unknown intent';
              response.shouldEndSession = true;
              response.done();
            }
        }
        else if (event.request.type === 'SessionEndedRequest') {
            onSessionEnded(event.request, event.session);
            context.succeed();
        }
    } catch (e) {
        context.fail('Exception: ' + getError(e));
    }
};

function getSlots(req) {
  var slots = {};
  for(var key in req.intent.slots) {
    slots[key] = req.intent.slots[key].value;
  }
  return slots;
}

var Response = function (context,session) {
  this.speechText = '';
  this.shouldEndSession = true;
  this.ssmlEn = true;
  this._context = context;
  this._session = session;
  this.repromptText = '';
  this.done = function(options) {

    if(options && options.speechText) {
      this.speechText = options.speechText;
    }

    if(options && options.repromptText) {
      this.repromptText = options.repromptText;
    }

    if(options && options.ssmlEn) {
      this.ssmlEn = options.ssmlEn;
    }

    if(options && options.shouldEndSession) {
      this.shouldEndSession = options.shouldEndSession;
    }

    this._context.succeed(buildAlexaResponse(this));
  };

  this.fail = function(msg) {
    logger.error(msg);
    this._context.fail(msg);
  };

};

function createSpeechObject(text,ssmlEn) {
  if(ssmlEn) {
    return {
      type: 'SSML',
      ssml: '<speak>'+text+'</speak>'
    }
  } else {
    return {
      type: 'PlainText',
      text: text
    }
  }
}

function buildAlexaResponse(response) {
  var alexaResponse = {
    version: '1.0',
    response: {
      outputSpeech: createSpeechObject(response.speechText,response.ssmlEn),
      shouldEndSession: response.shouldEndSession
    }
  };

  if(response.repromptText) {
    alexaResponse.response.reprompt = {
      outputSpeech: createSpeechObject(response.repromptText,response.ssmlEn)
    };
  }

  if(response.cardTitle) {
    alexaResponse.response.card = {
      type: 'Simple',
      title: response.cardTitle
    };

    if(response.imageUrl) {
      alexaResponse.response.card.type = 'Standard';
      alexaResponse.response.card.text = response.cardContent;
      alexaResponse.response.card.image = {
        smallImageUrl: response.imageUrl,
        largeImageUrl: response.imageUrl
      };
    } else {
      alexaResponse.response.card.content = response.cardContent;
    }
  }

  if (!response.shouldEndSession && response._session && response._session.attributes) {
    alexaResponse.sessionAttributes = response._session.attributes;
  }
  logger.debug('Final response:\n', JSON.stringify(alexaResponse,null,2),'\n\n');
  return alexaResponse;
}

function getError(err) {
  var msg='';
  if (typeof err === 'object') {
    if (err.message) {
      msg = ': Message : ' + err.message;
    }
    if (err.stack) {
      msg += '\nStacktrace:';
      msg += '\n====================\n';
      msg += err.stack;
    }
  } else {
    msg = err;
    msg += ' - This error is not object';
  }
  return msg;
}

function getMessage(id, token, callback){
  var url = `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?access_token=${token}`;
  https.get(url, function(res){
    var body = '';
    res.on('data', function(chunk){
      body += chunk;
    });
    res.on('end', function(){
      logger.debug(body);
      var result = JSON.parse(body);
      callback(result);
    });
  }).on('error', function(err){
    logger.error("Error: " + err);
    callback('', err);
  });
}


function readMessages(messages, response, session){
  logger.debug(messages);
  var promises = messages.map(function(message){
    return new Promise(function(resolve, reject){
      getMessage(message.id, session.user.accessToken, function(res, err){
        var from = res.payload.headers.find(o => o.name === 'From').value;
        from = from.replace(/<.*/, '');
        message.result = {
          snippet: res.snippet,
          subject: res.payload.headers.find(o => o.name === 'Subject').value,
          date: res.payload.headers.find(o => o.name === 'Date').value,
          from: from
        };
        resolve();

      });
    });
  });
  Promise.all(promises).then(function(){
    messages.forEach(function(message, idx){
      response.speechText += `<say-as interpret-as='ordinal'>${idx + 1}</say-as> Mail is ${message.result.from} with subject ${message.result.subject}`;

    });
    response.shouldEndSession = true;
    if (session.attributes.offset && session.attributes.offset > 0){
      response.speechText += 'Do you want me to read more?';
      response.repromptText = 'You can say for example yes or stop.';
      response.shouldEndSession = false;
    }
    response.done();
  }).catch(function(err){
    response.fail(err);
  });


}

var maxread = 3;
var maxmsg = 20;



function getMessages(response, session){
  var url;
  url = `https://www.googleapis.com/gmail/v1/users/me/messages?access_token=${session.user.accessToken}&q=is:unread`;
  logger.debug(url);
  https.get(url, function(res){
    var body = '';
    res.on('data', function(chunk){
      body += chunk;
    });
    res.on('end', function(){
      var result = JSON.parse(body);
      var messages;
      if (result.resultSizeEstimate){
        response.speechText = `You have ${result.resultSizeEstimate} unread mails in your inbox`;
        response.speechText += 'These are the latest ones';

        messages = result.messages;
        if (messages.length > maxread){
          session.attributes.messages = messages.slice(0, maxmsg);
          messages = messages.slice(0, maxread);
          session.attributes.offset = maxread;
        }
        readMessages(messages, response, session);
      }
      else{
        response.fail(body);
      }

    });
  }).on('error', function(err){
    response.fail(err);
  });

}


function readPassword(userID, callback){
  var params = {
    TableName: 'UserPasswords',
    Key: {
      "userId": userID
    }
  };

  docClient.get(params, function(err, data){
    if (err){
      callback(false, err);
      logger.error("Unable to read item ");
    }
    else{
      logger.debug(data);
      if(Object.keys(data).length === 0){
        callback(false);
      }
      else{
        callback(data);
      }
    }
  });
}


function createPassword(userID, password, callback){
  var hashed = bcrypt.hashSync(password, 10);
  var params = {
    TableName: 'UserPasswords',
    Item: {
      "userId": userID,
      "pin": hashed
    }
  };
  docClient.put(params, function(err, data){
    if (err){
      logger.error('Unable to add item')
      callback(false, err);
    }
    else{
      logger.debug('Added Item')
      callback(true)
    }
    
  });
  


}


function updatePassword(userID, password, callback){
  var hashed = bcrypt.hashSync(password, 10);
  logger.debug(`${password} hash is ${hashed}`);
  var params = {
    TableName: 'UserPasswords',
    Key: {
      "userId": userID
    },
    UpdateExpression: "set pin = :p",
    ExpressionAttributeValues: {
      ":p": hashed
    },
    ReturnValues: "UPDATED_NEW"
  };

  logger.debug('Updating the item...');
  docClient.update(params, function(err, data){
    if (err){
      logger.error('Unable to update item');
      callback(false, err);
    }
    else{
      logger.debug('Update item succeeded');
      callback(true);
    }
  });
}

//--------------------------------------------- Skill specific logic starts here -----------------------------------------

//Add your skill application ID from amazon devloper portal
var APP_ID = 'amzn1.ask.skill.7775a0ba-f431-4bcc-a03e-959f14b24c04';

function onSessionStarted(sessionStartedRequest, session) {
    logger.debug('onSessionStarted requestId=' + sessionStartedRequest.requestId + ', sessionId=' + session.sessionId);
    // add any session init logic here

}

function onSessionEnded(sessionEndedRequest, session) {
  logger.debug('onSessionEnded requestId=' + sessionEndedRequest.requestId + ', sessionId=' + session.sessionId);
  // Add any cleanup logic here

}

function onLaunch(launchRequest, session, response) {
  logger.debug('onLaunch requestId=' + launchRequest.requestId + ', sessionId=' + session.sessionId);
  response.speechText = 'Welcome to SL mail skill. You can use me to check, send and manage your emails.';
  response.repromptText = 'You can say for example, whats new in my inbox to check unread messages';
  response.shouldEndSession = false;
  response.done();
}


/** For each intent write a intentHandlers
Example:
intentHandlers['HelloIntent'] = function(request,session,response,slots) {
  //Intent logic

}
**/
intentHandlers['CheckMyMailIntent'] = function(request,session,response,slots) {
  //Intent logic
  readPassword(session.user.userId, function(res, err){
    if (err){
      response.fail(err)
    }
    else if (!res){
      response.speechText = "You haven't set your password. You have to set a password before proceeding. You can set it to any number";
      response.repromptText = ' You can say for example set my password to 1 2 3 4';
    }
    else{
      response.speechText = 'You need to tell your password. Whats your password?';
      response.repromptText = 'You can say for example my password is 1 2 3 4';
      session.attributes.CheckMyMailIntent = true;
      session.attributes.password = res.Item.pin;
    }
    response.shouldEndSession = false;
    response.done();
  });
  
}

intentHandlers['AuthIntent'] = function(request,session,response,slots) {
  //Intent logic
  var pwd1 = slots.password;
  var pwd2 = session.attributes.setpwd;

  if (pwd2){
    bcrypt.compare(pwd1, session.attributes.password, function(err, res){
      if (!res){
        response.speechText = 'Wrong password';
        response.shouldEndSession = true;
        response.done();
      }
      else{
        updatePassword(session.user.userId, pwd2, function(updateRes, err){
          if (updateRes){
            response.speechText = `Password updated to ${pwd2}`;
            response.shouldEndSession = true;
            response.done();
          }
          else{
            response.fail(err);
          }
        });
      }

    });
  }
  else if (session.attributes.CheckMyMailIntent){
    if (!session.user.accessToken){
      response.speechText = 'No token found';
      response.done();
    }
    else{
      bcrypt.compare(pwd1, session.attributes.password, function(err, res){
        if (!res){
          response.speechText = 'Wrong Password';
          response.shouldEndSession = true;
          response.done();
        }
        else{
          getMessages(response, session);
        }
      });
    }  
  }
  else{
    response.speechText = 'Wrong invocation of intent';
    response.shouldEndSession = true;
    response.done();

  }
} 


intentHandlers['SetPasswordIntent'] = function(request,session,response,slots) {
    //Intent logic
    var pwd = slots.password;
    readPassword(session.user.userId, function(cpwd, err){
      if (err){
        response.fail(err);
      }
      else if (!cpwd){
        createPassword(session.user.userId, pwd, function(res, err){
          if (res){
            response.speechText = `Successfully updated pin to <say-as interpret-as = "digits"> ${pwd} </say-as>`;
            response.shouldEndSession = true;
            response.done();
          }
        });
      }
      else{
        response.speechText = 'You need to tell your current password';
        response.repromptText = 'For example you can say my password is 1 2 3 4';
        response.shouldEndSession = false;
        session.attributes.setpwd = pwd;
        session.attributes.password = cpwd.Item.pin;
        response.done();
      }
    });
  
}

intentHandlers['ForgotPasswordIntent'] = function(request,session,response,slots) {
  //Intent logic
  var password = Math.floor(Math.random() * 90000) + 10000;
  updatePassword(session.user.userId, password.toString(), function(updateRes, err){
    if (updateRes){
      response.cardTitle = 'SL Mail Skill recovery password';
      response.cardContent = `Your new password is set to ${password}`;
      response.speechText = 'We have sent a recovery pin to your alexa app. Please check it';
      response.shouldEndSession = true;
      response.done();
    }
    else{
      response.fail(err);
    }
  });

}

intentHandlers['AMAZON.StopIntent'] = function(request,session,response,slots) {
  //Intent logic
  response.speechText = 'Thank you for using me. Have a nice day!';
  response.shouldEndSession = true;
  response.done();

}



intentHandlers['AMAZON.YesIntent'] = function(request,session,response) {
  //Intent logic
  var messages;
  if (session.attributes.messages && session.attributes.offset > 0){
    messages = session.attributes.messages.slice(session.attributes.offset);
    logger.debug(session.attributes.messages);
    if (messages.length > maxread){
      messages = messages.slice(0, maxread);
      session.attributes.offset += maxread;
    }
    else{
      session.attributes.offset = 0;
    }
    readMessages(messages, response, session);
  }
  else{
    response.speechText = 'Wrong invocation of intent';
    response.shouldEndSession = true;
    response.done();
  }
}

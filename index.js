exports.handler = function(event, context){
  const request = event.request;
  //Type of Request!!
  if (request.type === 'LaunchRequest'){
    var resObj = {
      outputText: 'Welcome to the online Shopper Skill. You can use me to shop online on a number of shopping sites. What are you looking for?',
      repromptText: 'You can say for example I want to buy shoes from Amazon.',
      endSession: false
    };
    response


  }
  //code to be filled here for all three intents regarding data extraction through API
  else if (request.type === 'IntentRequest'){

  }
  else if (request.type === 'SessionEndedRequest'){

  }
  else {

  }
}




//Function to return a response in the form of JSON.
function response(resObj){
   var res = {
     version: "1.0",
     response: {
       outputSpeech: {
         type: "PlainText",
         text: resObj.ouputText
    },
      /*"card": {
        "type": "Standard",
        "title": "Title of the card",
        "content": "Content of a simple card",
        "text": "Text content for a standard card",
        "image": {
          "smallImageUrl": "https://url-to-small-card-image...",
          "largeImageUrl": "https://url-to-large-card-image..."
        }
      },*/
       reprompt: {
         outputSpeech: {
           type: "PlainText",
           text: ""
        }
      },
      /*"directives": [
        {
          "type": "InterfaceName.Directive"
          (...properties depend on the directive type)
        }
      ],*/
    shouldEndSession: resObj.endSession
    }
  };
  if (resObj.repromptText){
    res.response.reprompt.outputSpeech.text = resObj.repromptText;
  }
  return res;
}

//yashSS

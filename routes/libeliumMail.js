var express = require('express');
var router = express.Router();
var config = require('../config/config.json');
var FUNCTION = require('../function.js');
var Promise = require('promise');
// Required for LDAP connection
var ldap = require('ldapjs');

// Set the http status values
var httpStatus = {
    OK: 200,
    InternalServerError: 500
};


router.post('/', function (req, res) {
  
  
    const reqData = req.body;
    
    FUNCTION.libeliumInstructionsMail(reqData)
    .then((emailRes) => {
        var myObj = new Object();
     
        myObj.message = "Instructions sent successfully.";
        res.status(200).send(JSON.stringify(myObj));
       }) .catch((emailErr) => {
        logger.error("email not sent>>>", emailErr);
        var myObj1 = new Object();
      
        myObj1.message = "Unable to send a email.";
        res.status(400).send(JSON.stringify(myObj1));
        
    });

});

router.post('/GetPassword', function (req, res) {
 

 const reqData = req.body;
 FUNCTION.libeliumPasswordMail(reqData)
 .then((emailRes) => {
     var myObj = new Object();
  
     myObj.message = "Password request sent to RoboMQ successfully.";
     res.status(200).send(JSON.stringify(myObj));
    }) .catch((emailErr) => {
     logger.error("email not sent>>>", emailErr);
     var myObj1 = new Object();
   
     myObj1.message = "Unable to send a email.";
     res.status(400).send(JSON.stringify(myObj1));
  
 });

});

module.exports = router;

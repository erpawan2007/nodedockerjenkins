var express = require('express');
var router = express.Router();
var ldap = require('ldapjs');
var FUNCTION = require('../function.js');
var config = require('../config/config.json');
// Set the LDAP arguments
const ldapUser = config.ldapDetails.user;
const ldapUserPwd = config.ldapDetails.pwd;
const ldapServerURL = config.ldapDetails.server;
const ldapStartDN = config.ldapDetails.base;
const ldapTimeOut = config.ldapDetails.ldapTimeOut;
const ldapconnectTimeout = config.ldapDetails.ldapconnectTimeout; 

/** reset user account password. 
 * user will submit new password from UI
 * dummy request:
 * {"email":"pawan@robomq.io", "password":"12345678"}
 */

router.post('/', function(req, res){
    // Create the LDAP client
    var reqData = req.body;
    logger.info("req body>>>"+JSON.stringify(reqData));
    var validator = require('validator');
	var formValid = true;
    var errorMessage ={};
    if(!validator.isEmail(reqData.email)){
        formValid = false;
        errorMessage['email']="Please provide valid email address.";
    }
    if(validator.isEmpty(reqData.password)){
        formValid = false;
        errorMessage['password'] ="Please provide valid password.";
    }
    // logger.info("has value >>>>"+validator.isHash(reqData.hash));
    if(validator.isEmpty(reqData.hash) ){
        formValid = false;
        errorMessage['password'] ="Please provide valid hash value.";
    }
    
    logger.info("formValid>>>>"+formValid);
    logger.info("errorMessage>>>>"+JSON.stringify(errorMessage));
    if(formValid){
        FUNCTION.createClient()
        .then( (client)=>{

            let uid = reqData.email;
            let newPasswd = reqData.password;
            let hash = reqData.hash;
            // let timestampValue = hash[1];

            let attributes = "uid,cn,sn,initials,employeeNumber,userPassword";
            // Set filter for search
            ldapFilter = '(uid=' + uid + ')';
            ldapAttributes = attributes.split(',');
            // Set the parameters for LDAP search
            var parameters = {
                    filter: ldapFilter,
                    scope: 'sub',
                    attributes: ldapAttributes
            };
            logger.info("Search usesr with ldapStartDN="+ldapStartDN+", parameters="+ parameters);
            FUNCTION.serchUser(client, ldapStartDN, parameters)
            .then((result)=>{
                /**
                 * Now serach for uid with fetched DN
                 */
                let dnData = result[0];
                let updatingDN  = dnData.dn;
                var convertString = dnData.uid+dnData.employeeNumber;
                var hashValue = FUNCTION.createhash(convertString);
                var labeledURIValue = "";
                let timestampRegister = new Date().getTime();

                logger.info('convertStringhashValue>>>>'+hashValue);
                logger.info('hash>>>>'+hash);
                if(hashValue!=hash){
                    logger.error("Reset password link is not a valid link");
                    var myObj = new Object;
                    myObj["message"] = "Reset password link is not a valid link.";
                    res.status(401).send(myObj);
                    return;
                }

                var change = new ldap.Change({
                            operation: 'replace',
                            modification: {
                                userPassword: [newPasswd]
                            }
                    });
                //modifies the detail i.e. password of user
                FUNCTION.modifyUser(client, updatingDN, change)
                .then(function (response) {
                    /**
                     * modifies the detail i.e. timestamp of user which is 
                     * stored in employeeNumber right now
                     */
                    var uriChange = new ldap.Change({
                            operation: 'replace',
                            modification: {
                                    employeeNumber: [timestampRegister]
                            }
                        });
                        
                        
                        FUNCTION.modifyUser(client, updatingDN, uriChange)
                        .then(function (result) {
                            var myObj = new Object;
                            myObj["message"] = "Your password changed successfully.";
                            res.status(200).send(myObj);
                        })
                        .catch(function (err) {
                            var myObj = new Object;
                            myObj["message"] = "Some error occured while updating password for user account. Please try after some time.";
                            logger.error("Error in modify user timestamp>>>>"+ JSON.stringify(err));
                            res.status(200).send(myObj);
                        })
                })
                .catch(function (err) {
                        var myObj = new Object;
                        myObj["message"] = "Some error occured while updating password. Please try after some time.";
                        logger.error("Error in modify User password>>>>"+ JSON.stringify(err));
                        res.status(200).send(myObj);
                })
            })
            .catch((error)=>{
                logger.error("Error in searching User associated with link>>>>"+ JSON.stringify(error));
                var myObj = new Object;
                myObj["message"] = "User not found with associated link.";
                res.status(401).send(myObj);
            });
        })
        .catch( (error) => {
            logger.error("ldap connection error occured in reset password method"+ error);
            var myObj = new Object();
            myObj['message']="Unable to connect you right now. Please try after some time.";
            res.status(500).send(JSON.stringify(myObj));
        });
    }
    else{
        logger.error("form vaidation error" + errorMessage);
        var myObj = new Object();
        myObj['message'] = "Please provide valid form values.";
        myObj['errorMessage'] = errorMessage;
        res.status(422).send(JSON.stringify(myObj));
    }
});

router.post('/checklink', function(req, res){
    var reqData = req.body;
    
    // Create the LDAP client
    FUNCTION.createClient()
    .then( (client)=>{

        let uid = reqData.email;
        let hash = reqData.hash;
        // let timestampValue = hash[1];
        let attributes = "uid,cn,sn,initials,employeeNumber,userPassword";
        // Set filter for search
        ldapFilter = '(uid=' + uid + ')';
        ldapAttributes = attributes.split(',');
        // Set the parameters for LDAP search
        var parameters = {
                filter: ldapFilter,
                scope: 'sub',
                attributes: ldapAttributes
        };
        
        FUNCTION.serchUser(client, ldapStartDN, parameters)
        .then((result)=>{
            /**
             * Now serach for uid with fetched DN
             */
            let dnData = result[0];
            var convertString = dnData.uid+dnData.employeeNumber;
            var hashValue = FUNCTION.createhash(convertString);
            
            if(hashValue!=hash){
                var myObj = new Object;
                myObj["message"] = "Reset password link is not a valid link.";
                myObj["linkexpire"] = true;
                res.status(401).send(myObj);
                return;
            }
            
            let createdTime = parseInt(dnData.employeeNumber);

            let currentTime =  new Date().getTime();
            
            let hours = Math.abs((currentTime - createdTime) / 3600000);
            
            if(hours > config.linkexpirationHours){
                let myObj = new Object;
                myObj["message"]="This link has expired.";
                logger.error("Verification link has expired");
                myObj['linkexpire']=true;
                res.status(401).send(myObj);
                return;
            }

            // if(labeledURI==undefined || labeledURI == ''){
            //     var myObj = new Object;
            //     myObj["message"] = "This link has been expired.";
            //     myObj["linkexpire"] = true;
            //     res.status(401).send(myObj);
            // }
            else{
                var myObj = new Object;
                myObj["message"] = "This link is valid.";
                myObj["linkexpire"] = false;
                res.status(200).send(myObj);
            }
        })
        .catch((error)=>{
            
            logger.error("Error in searching user>>>"+ error);
            var myObj = new Object;
            myObj["message"] = "Password not updated.";
            res.status(401).send(myObj);
        });
    })
    .catch( (error) => {
        logger.error("ldap connection error occured"+ error);
        var myObj = new Object();
        myObj['message']="Unable to connect you right now. Please try after some time.";
        res.status(500).send(JSON.stringify(myObj));
    });

});

module.exports = router;
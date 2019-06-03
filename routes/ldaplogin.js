var express = require('express');
var router = express.Router();

var LdapStrategy = require('passport-ldapauth').Strategy;
var passport     = require('passport');
var config = require('../config/config.json');
var FUNCTION = require('../function.js');
var async = require('async'); 
var Promise = require('promise');
var ldap = require('ldapjs');
// var config = require('./config');

// Set the LDAP arguments
const ldapUser = config.ldapDetails.user;
const ldapUserPwd = config.ldapDetails.pwd;
const ldapServerURL = config.ldapDetails.server;
const ldapStartDN = config.ldapDetails.base;
const ldapTimeOut = config.ldapDetails.ldapTimeOut;
const ldapconnectTimeout = config.ldapDetails.ldapconnectTimeout; 

// login with ldap and get the details of the user
// return the details of the user ou=organization unit, o=organization, uid=userID
// if the details are not present returns {"ou":"undefined", "o":"undefined", "uid":"undefined"}
router.post('/', async function (req, res, next) {
    
    var validator = require('validator');
    var reqData = req.body;
    logger.info("for login reqData>>>"+JSON.stringify(reqData));
    var formValid = true;
    var errorMessage ={};

    if(!validator.isEmail(reqData.username)){
        formValid = false;
        errorMessage['email']="Please provide valid email address.";
    }
    if(validator.isEmpty(reqData.password)){
        formValid = false;
        errorMessage['password'] ="Please provide valid password.";
    }

    if(formValid){
        // Create the LDAP client
        
        FUNCTION.createClient()
        .then( (client)=>{
            var OPTS = {
                server: {
                    url: ldapServerURL,
                    bindDn: ldapUser,
                    bindCredentials: ldapUserPwd,
                    searchBase: ldapStartDN,
                    searchFilter: '(uid={{username}})',
                    searchAttributes: '*'
                },
                handleErrorsAsFailures: true
            }
            
            passport.use(new LdapStrategy(OPTS));
            passport.serializeUser(function (user, done) {
                done(null, user);
            });

            passport.deserializeUser(function (id, done) {
                done(null, id);
            });

            router.use(passport.initialize());
            
            passport.authenticate('ldapauth',{ session: false, userNotFound: 'Sorry, but we could not find that username.' ,
                invalidCredentials:'Invalid Credentials provided.', badRequestMessage:'Missing Credentials'},function (err, user, info) {
                if(err)  {
                    logger.error("passport authentication failed with error: "+err);
                    res.response(400).send(err);
                }
                else if(!user) {
                    let myObj = new Object();
                    myObj.o = 'undefined';
                    myObj.ou = 'undefined';
                    myObj.uid = 'undefined';
                    myObj.status = 'undefined';
                    if(!res.headersSent){
                        res.status(200).end(JSON.stringify(myObj));
                    }
                }
                else {
                    var myObj = new Object();
                    var attr = user.dn.split(","); // split the dn on ','
                    if(user.initials == 'f'){
                        myObj.o = 'undefined';
                        myObj.ou = 'undefined';
                        myObj.uid = 'defined';
                        myObj.status = user.initials;
                        // res.set("Content-Type", "application/json");
                        if(!res.headersSent){
                            res.status(200).end(JSON.stringify(myObj));
                        }
                    } else{
                        /**
                         * split DN on first occureence of comma
                         * it will remove the uid from dn string
                         */
                        var searchDN =  user.dn.split(/,(.+)/)[1];
                        var parameters = {
                            filter: '(ou='+user.uid+')',
                        //    filter: '(uid=*)',
                            scope: 'sub',
                            attributes: ['*']
                        };

                        /**
                         * Perform the search under OU=UUID for all linked account 
                         */
                        logger.info("searching user with searchDN="+searchDN+", parameters="+JSON.stringify(parameters));
                        FUNCTION.serchUser(client, searchDN, parameters)
                        .then(function(entry){
                            // logger.info("entry result >>>", entry);
                            let ouDetail = entry[0];
                            for(i=0; i < attr.length; i++) {

                                // check for organization
                                if(attr[i].indexOf("o=") > -1){
                                    var temp = attr[i].split("=");
                                    myObj.o = temp[1];
                                }
                
                                // check for organization unit
                                if(attr[i].indexOf("ou=") > -1){
                                    
                                    var temp = attr[i].split("=");
                                    myObj.uuid = temp[1];
                                    attr.splice(i, 1);
                                }
                                if(attr[i].indexOf("ou=") > -1){
                                    
                                    var temp = attr[i].split("=");
                                    myObj.ou = temp[1];
                                }
                
                                // check for user Id
                                if(attr[i].indexOf("uid=") > -1){
                                    var temp = attr[i].split("=");
                                    myObj.uid = temp[1];
                                }
                
                            }
                            logger.info('ouDetail>>>>'+ JSON.stringify(ouDetail));
                            let vhost = req.body.username.split('@');
                            myObj.firstname = user.cn;
                            myObj.lastname = user.sn;
                            myObj.mobile = user.mobile;
                            myObj.mail = user.mail;
                            myObj.status = user.initials;
                            myObj.vhost = vhost[1];
                            myObj.company = user.o;
                            myObj.bussiness_category = ouDetail['businessCategory'];
                            sess = req.session;
                            logger.info('sess>>>>>>>>>'+JSON.stringify(sess));
                            sess.key = myObj.uid;
                            sess.username = myObj.uid;
                            sess.o = myObj.o;
                            sess.ou = myObj.ou;
                            sess.uuid = myObj.uuid;
                            sess.uid = myObj.uid;
                            sess.vhost = vhost[1];
                            sess.broker_password = ouDetail['userPassword'];
                            sess.bussiness_category = ouDetail['businessCategory'];
                            sess.session_id = req.sessionID;
                            myObj.sessionId=sess.session_id;
                            logger.info('myObj>>>>'+ JSON.stringify(myObj));
                            // myObj.socialAccounts = entry;
                            // if(entry.length > 0 && entry[0].employeeType=='google'){
                            //     myObj.linkedAccount = 'yes';
                            // }else{
                            //     myObj.linkedAccount = 'no';
                            // }
                            
                            /** added line
                             * creating redis key for storing multiple session id of same user
                             * key pattern "sessions:pawan@mailinator.com" 
                             */
                            rclient.sadd("sessions:" + myObj.uid, "sess:" + req.sessionID);
                            /** end */
                            FUNCTION.destroyClient(client);
                            myObj.linkedAccount = 'no';
                            res.setHeader('Access-Control-Allow-Origin','*');
                            res.set("Content-Type", "application/json");
                            res.status(200).end(JSON.stringify(myObj));
                        })
                        .catch(function(err){
                            logger.error("Error while searching user-->"+ err);
                            var myObj = new Object();
                            myObj['message']="Something went wrong. Please try after some time.";
                            res.status(500).send(JSON.stringify(myObj));
                        }) 
                    }          
                }
                
            })(req, res, next);
        })
        .catch( (error) => {
            logger.error("ldap connection error: ", error);
            var myObj = new Object();
            myObj['message']="Unable to login you right now. Please try after some time.";
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

module.exports = router;
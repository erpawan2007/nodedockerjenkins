var express = require('express');
var router = express.Router();
var config = require('../config/config.json');
var FUNCTION = require('../function.js');
var countryTelephoneData = require("country-telephone-data")
var Promise = require('promise');
// Required for LDAP connection
var ldap = require('ldapjs');
// Set the LDAP arguments
const ldapUser = config.ldapDetails.user;
const ldapUserPwd = config.ldapDetails.pwd;
const ldapServerURL = config.ldapDetails.server;
const ldapTimeOut = config.ldapDetails.ldapTimeOut;
const ldapconnectTimeout = config.ldapDetails.ldapconnectTimeout;

const ldapStartDN = config.ldapDetails.base;
// Set the http status values
var httpStatus = {
    OK: 200,
    InternalServerError: 500
};

function createNewUser(client, dnData, entryData) {
    // Setting URL and headers for request
    // Return new promise 
    return new Promise(function (resolve, reject) {
        // Do async job

        client.add(dnData, entryData, function (err, body) {
            if (err) {
                // logger.error('Promise Rejection--->', err);
                reject(err);
            } else {
                resolve(body);
            }
        })
    })
}

/**
 * Register New user. This API
 * check the user if he is present in ldap, broker and redis
 * if user not present in ldap and exist in broker or redis
 * first all these entry will remove and user have to try again
 * after successful registration an email with verificatio link
 * has been send on registered email
 */

router.post('/register', function (req, res) {
    /** module for validation */
    const validator = require('validator');

    var restrictedDomains = config.restrictedDomains;
    reqData = req.body;
    // logger.info('reqData>>>'+JSON.stringify(reqData));

    /**split email with "@" */
    let fetchEmailpart = reqData.email.split('@');
    /** split the string again with "." and fetch the domain name of email */
    getDomainName = fetchEmailpart[1].split('.');
   
    if(restrictedDomains.includes(getDomainName[0])){
        res.status(401).send({"message":"Sorry, currently we accept only corporate account!"})
    }
    else{
        userEmail = reqData.email;
        var filter = userEmail;
        var attributes = "uid"; //"mail,cn,uid,telephonenumber";
        
        var ldapFilter = "";
        var ldapAttributes = "";
        var formValid = true;
        var errorMessage ={};
        /** for matching the first and last name if it contain any 
         * special character except "." and number
        */
        // var regex = /[a-z_A-Z][^!@#&<>\"~;$^%{}?0-9]{4,40}$/;
        var regex = /^[a-z_A-z 0-9.]+$/;
        var regexCompany = /^[a-z_A-z 0-9@$&.]+$/;
        var regexEmail = /^[a-z_A-z0-9@.]+$/;
        logger.info("matching first name>>>>"+regex.test(reqData.firstname));
        logger.info("matching last name>>>>"+regex.test(reqData.lastname));
        logger.info("matching company name>>>>"+regexCompany.test(reqData.company));

        if(validator.isEmpty(reqData.firstname) || !regex.test(reqData.firstname)){
            formValid = false;
            errorMessage['firstname']="Please provide valid first name.";
        }
        if(validator.isEmpty(reqData.lastname) || !regex.test(reqData.lastname)){
            formValid = false;
            errorMessage['lastname']="Please provide valid last name.";
        }

        if(!validator.isEmail(reqData.email) || !regexEmail.test(reqData.email)){
            formValid = false;
            errorMessage['email']="Please provide valid email address.";
        }
        if(validator.isEmpty(reqData.company) || !regexCompany.test(reqData.company)){
            formValid = false;
            errorMessage['company'] ="Please provide valid company name.";
        }
        if(validator.isEmpty(reqData.password) || !validator.isLength(reqData.password, {"min":8, "max":16})){
            formValid = false;
            errorMessage['password'] ="Please provide valid password.";
        }
        logger.info("formValid>>>"+formValid);
        logger.info("errorMessage>>>"+errorMessage);
        if(formValid){
                // Create the LDAP client
            FUNCTION.createClient()
                .then((client) => {
                    // Set filter for search
                    ldapFilter = '(uid=' + filter + ')';//filter.split(',');
                    ldapAttributes = attributes.split(',');
                    // Set the parameters for LDAP search
                    var parameters = {
                        filter: ldapFilter,
                        scope: 'sub',
                        attributes: ldapAttributes
                    };
                    /**
                     * search user in ldap server
                     */
                    FUNCTION.serchUser(client, ldapStartDN, parameters)
                        .then(function (searchResults) {
                            if (searchResults.length == 0) {
                                
                                //fetchEmailpart[0].replace(/[^a-z\d\s]+/gi, "");
                                /** create password for provisoning */

                                let provisioningPassword = FUNCTION.generate(8);

                                /**
                                 * convert company name in lowercase and remove space, dot & special char
                                 * create a DN for all level
                                 */
                                // let companyName=reqData.company.toLowerCase();
                                // companyName = companyName.replace(/[^a-zA-Z0-9]+/g, "");

                                let getCompany = reqData.email.split('@');
                                let vhost = companyName = getCompany[1];
                                // let vhost = fetchEmailpart[1];
                                const companyDN = "o=" + companyName + "," + ldapStartDN;
                                const technoDN = "ou=technology,o=" + companyName + "," + ldapStartDN;
                                const uuidDN = "ou=" + userEmail + "," + technoDN;
                                const uidDN = "uid=" + userEmail + "," + uuidDN;
                                /**
                                 * get busines category from businesscategory config
                                 */
                                let userbusinessCategory = FUNCTION.getBusinessCategoryByDomain(vhost);
                                /**
                                 * creating insertdata for each DN
                                 */
                                const entry1 = {
                                    objectclass: ['organization'],
                                    o: companyName
                                };
                                const entry2 = {
                                    objectclass: ['organizationalUnit'],
                                    ou: 'technology'
                                };
                                const entry3 = {
                                    objectclass: ['organizationalUnit'],
                                    ou: userEmail,
                                    businessCategory: userbusinessCategory,
                                    userPassword: provisioningPassword
                                };

                                /**
                                 * Data type and values we are using
                                 *  
                                 * employeeType: accountType (google,o365, ldap)
                                 * initials: accountStatus ('t', 'f')
                                 * title: primaryAccount ('primary', 'secondary')
                                 * employeeNumber: timestamp
                                 */
                                let initials = 't';
                                if (reqData.memberOf == 'ldap') {
                                    initials = 'f';
                                }
                                let timestampRegister = new Date().getTime();

                                let entry4 = {
                                    cn: reqData.firstname,
                                    sn: reqData.lastname,
                                    mail: reqData.email,
                                    objectclass: ['inetOrgPerson'],
                                    uid: reqData.email,
                                    employeeType: reqData.memberOf,
                                    title: "primary",
                                    initials: initials,
                                    employeeNumber: timestampRegister,
                                    userPassword:reqData.password,
                                    o:reqData.company
                                };
                                if(reqData.contact.trim()!= ''){
                                    entry4['mobile'] = reqData.contact
                                }
                                
                                let hubspotContact = {
                                    method:"create",
                                    firstName: reqData.firstname,
                                    lastName: reqData.lastname,
                                    email: reqData.email,
                                    company:reqData.company,
                                    phone:reqData.contact,
                                    LeadStatus:"Connect Trial"
                                }
                                
                                createNewUser(client, companyDN, entry1)
                                    .catch(function (errorHandler) {

                                        if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                            logger.info('No worries as the organization already exists >>' + errorHandler.name);
                                            return;
                                        }
                                        else {
                                            var myObj = new Object();
                                            myObj['message'] = "Some error occured while creating organization.";
                                            res.status(500).send(JSON.stringify(myObj));
                                        }

                                    })
                                    .then((val) => {
                                        /**
                                         * creating a organization unit under Organization
                                         */

                                        createNewUser(client, technoDN, entry2)
                                            .catch(function (errorHandler) {
                                            if (errorHandler.name.indexOf('EntryAlreadyExistsError') > -1) {
                                                logger.info('No worries as the organization Unit already exists.>>>' + errorHandler.name);
                                                return;
                                            }
                                            else {
                                                var myObj = new Object();
                                                myObj['message'] = "Some error occured while creating organization unit." + errorHandler.name;
                                                res.status(500).send(JSON.stringify(myObj));

                                            }
                                        })
                                        .then((result) => {
                                            // logger.info("result>>"+result);
                                            /**
                                             * creating a dynamic UUID for new User
                                             */
                                            // logger.info("entry3 data>>>"+entry3);
                                            createNewUser(client, uuidDN, entry3)
                                                .catch(function (errorHandler) {
                                                    var myObj = new Object();
                                                    myObj['message'] = "Some error occured while creating UUID. Error name: " + errorHandler.name;
                                                    res.status(500).send(JSON.stringify(myObj));
                                                })
                                                .then((result) => {
                                                    /**
                                                     * Insert User information under the UUID
                                                     */
                                                    logger.info("entry4 data>>>"+JSON.stringify(entry4));
                                                    createNewUser(client, uidDN, entry4)
                                                        .then(finalres => {
                                                            /**
                                                             * we have to send an email after user inserted in ldap
                                                             */
                                                            FUNCTION.checkvhost(userEmail)
                                                                .then(function (result) {

                                                                    FUNCTION.createVhost(vhost, userEmail, provisioningPassword)
                                                                        .then(function (createRes) {
                                                                            /** add user information in Redis database */
                                                                            //let custkey = vhost + ":profile";
                                                                            /**checkUser In redis */
                                                                            // FUNCTION.checkUserInRedis(custkey, userEmail)
                                                                            // .then(function (checkRedis) {
                                                                                // let info = new Object();
                                                                                // let userInfo = new Object();
                                                                                // let user = [];
                                                                                // userInfo.FullName = reqData.firstname + " " + reqData.lastname;
                                                                                // userInfo.username = reqData.email;
                                                                                // userInfo.password = provisioningPassword;
                                                                                // userInfo.connections = [];
                                                                                // user.push(userInfo);
                                                                                // info['name'] = reqData.company;
                                                                                // info['user'] = user;

                                                                                // FUNCTION.insertInRedis(custkey, info)
                                                                                // .then((redisRes) => {
                                                                                    /** send an activation email on success */
                                                                                    /** send registration email */
                                                                                    FUNCTION.registerEmail(reqData)
                                                                                    .then((emailRes) => {
                                                                                        /** [CU-626] Create Hubspot Contact  */
                                                                                        FUNCTION.createHubspotContact(JSON.stringify(hubspotContact))
                                                                                        .then((createContactRes)=>{
                                                                                            logger.info('createContactRes>>'+createContactRes);
                                                                                        })
                                                                                        .catch((createContactErr)=>{
                                                                                            logger.info('createContactErr>>'+createContactErr);
                                                                                        });
                                                                                        /** [CU-626] Create Hubspot Contact END */
                                                                                        var myObj = new Object();
                                                                                        myObj.uid = entry4.uid;
                                                                                        myObj.message = "User register successfully.";
                                                                                        res.status(200).send(JSON.stringify(myObj));
                                                                                    })
                                                                                    .catch((emailErr) => {
                                                                                        logger.error("email not sent>>>", emailErr);
                                                                                        var myObj = new Object();
                                                                                        myObj.uid = entry4.uid;
                                                                                        myObj.message = "User register successfully, but there is an issue in sending email.";
                                                                                        if (!res.headersSent) {
                                                                                            res.status(200).send(JSON.stringify(myObj));
                                                                                        }
                                                                                    });
                                                                                    
                                                                                // })
                                                                                // .catch((redisErr) => {
                                                                                //     logger.error("Unable to insert user in redis database>>>>" + redisErr);
                                                                                //     FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                                //         .then((response) => {
                                                                                //             var myObj = new Object();
                                                                                //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                //             if (!res.headersSent) {
                                                                                //                 res.status(500).send(JSON.stringify(myObj));
                                                                                //             }
                                                                                //         })
                                                                                //         .catch((errorDelete) => {
                                                                                //             var myObj = new Object();
                                                                                //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                                //             logger.error(myObj['message'] + ">>>" + errorDelete);
                                                                                //             if (!res.headersSent) {
                                                                                //                 res.status(500).send(JSON.stringify(myObj));
                                                                                //             }
                                                                                //         })
                                                                                // })
                                                                            // })
                                                                            // .catch(existRedis=>{
                                                                            //     logger.error("Alredy exist in redis>>>" + existRedis)
                                                                            //     FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                            //         .then((response) => {
                                                                            //             var myObj = new Object();
                                                                            //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            //             if (!res.headersSent) {
                                                                            //                 res.status(500).send(JSON.stringify(myObj));
                                                                            //             }
                                                                            //         })
                                                                            //         .catch((errorDelete) => {
                                                                            //             logger.error("Error while deleting user entry if exist in redis");
                                                                            //             var myObj = new Object();
                                                                            //             myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            //             if (!res.headersSent) {
                                                                            //                 res.status(500).send(JSON.stringify(myObj));
                                                                            //             }
                                                                            //         })

                                                                            // })
                                                                            

                                                                        })
                                                                        .catch(function (error) {
                                                                            logger.error("Unable to create vhost>>>" + error)
                                                                            FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                                .then((response) => {
                                                                                    var myObj = new Object();
                                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";//"Some internal server error. Error name: "+redisErr;
                                                                                    if (!res.headersSent) {
                                                                                        res.status(500).send(JSON.stringify(myObj));
                                                                                    }
                                                                                })
                                                                                .catch((errorDelete) => {
                                                                                    logger.error("Error while deleting user entry if vhost not created");
                                                                                    var myObj = new Object();
                                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";//"Some internal server error. Error name: "+errorDelete.name;
                                                                                    if (!res.headersSent) {
                                                                                        res.status(500).send(JSON.stringify(myObj));
                                                                                    }
                                                                                })

                                                                        })
                                                                })
                                                                .catch(function (error) {
                                                                    logger.error("vhost already exist>>>" + error)
                                                                    /** Delete user UUID DN if uid insertion has been failed */
                                                                    FUNCTION.rollbackUserRegistration(client, entry4.mail)
                                                                        .then((response) => {
                                                                            var myObj = new Object();
                                                                            // logger.error("Some internal server error. Error name: "+error);
                                                                            myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            if (!res.headersSent) {
                                                                                res.status(500).send(JSON.stringify(myObj));
                                                                            }
                                                                        })
                                                                        .catch((errorDelete) => {
                                                                            var myObj = new Object();
                                                                            logger.error("Error while Doing rollback user registration. Error name: " + errorDelete.name);
                                                                            myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                            if (!res.headersSent) {
                                                                                res.status(500).send(JSON.stringify(myObj));
                                                                            }
                                                                        })
                                                                })
                                                        })
                                                        .catch(function (errorHandler) {
                                                            logger.error("Error while adding UID in ldap----->", errorHandler);
                                                            /** Delete user UUID DN if uid insertion has been failed */
                                                            FUNCTION.deleteUser(client, uuidDN)
                                                                .then((response) => {
                                                                    var myObj = new Object();
                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                    if (!res.headersSent) {
                                                                        res.status(500).send(JSON.stringify(myObj));
                                                                    }
                                                                })
                                                                .catch((errorDelete) => {
                                                                    logger.error("Error while Deleting the ldap entry>>" + errorDelete)
                                                                    var myObj = new Object();
                                                                    myObj['message'] = "Unable to register user right now. Please try after some time.";
                                                                    if (!res.headersSent) {
                                                                        res.status(500).send(JSON.stringify(myObj));
                                                                    }
                                                                })
                                                        })
                                                })
                                        })
                                })
                        }
                        else {
                            if (reqData.hasOwnProperty('profileId') && reqData.profileId != '') {
                                let userData = searchResults[0];
                                let userDN = userData.dn;

                                var change = new ldap.Change({
                                    operation: 'replace',
                                    modification: {
                                        employeeType: [reqData.memberOf]
                                    }
                                });
                                var change1 = new ldap.Change({
                                    operation: 'replace',
                                    modification: {
                                        l: [reqData.profileId]
                                    }
                                });

                                var promise1 = FUNCTION.modifyUser(client, userDN, change);
                                var promise2 = FUNCTION.modifyUser(client, userDN, change1);
                                Promise.all([promise1, promise2]).then((executeRes) => {
                                    var attributes = "uid,cn,sn,initials,employeeNumber,userPassword,employeeType,title,mobile,o";
                                    var getAttributes = attributes.split(',');
                                    // Set the parameters for LDAP search
                                    var parameters = {
                                        filter: ldapFilter,
                                        scope: 'sub',
                                        attributes: getAttributes
                                    };
                                    FUNCTION.serchUser(client, ldapStartDN, parameters)
                                        .then(function (result) {
                                            // callback(null, result);
                                            user = result[0];
                                            var myObj = new Object;
                                            var attr = user.dn.split(",");
                                            for (i = 0; i < attr.length; i++) {

                                                // check for organization
                                                if (attr[i].indexOf("o=") > -1) {
                                                    var temp = attr[i].split("=");
                                                    myObj.o = temp[1];
                                                }

                                                // check for organization unit
                                                if (attr[i].indexOf("ou=") > -1) {

                                                    var temp = attr[i].split("=");
                                                    myObj.uuid = temp[1];
                                                    attr.splice(i, 1);
                                                }
                                                if (attr[i].indexOf("ou=") > -1) {

                                                    var temp = attr[i].split("=");
                                                    myObj.ou = temp[1];
                                                }

                                                // check for user Id
                                                if (attr[i].indexOf("uid=") > -1) {
                                                    var temp = attr[i].split("=");
                                                    myObj.uid = temp[1];
                                                }
                                            }
                                            let vhost = user.uid.split('@');
                                            myObj.firstname = user.cn;
                                            myObj.lastname = user.sn;
                                            myObj.mobile = user.mobile;
                                            myObj.mail = user.mail;
                                            myObj.status = user.initials;
                                            myObj.vhost = vhost[1];
                                            myObj.company = user.o;
                                            sess = req.session;
                                            sess.username = user.uid;
                                            sess.o = myObj.o;
                                            sess.ou = myObj.ou;
                                            sess.uid = myObj.uid;
                                            sess.vhost = vhost[1];
                                            // sess.vhost = req.query.vhost;
                                            sess.session_id = req.sessionID;
                                            res.set("Content-Type", "application/json");
                                            myObj.sessionId = sess.session_id;
                                            res.status(200).end(JSON.stringify(myObj));

                                        })
                                        .catch(function (error) {
                                            logger.error("error while searcing soical user in ldap>>>>"+ error);
                                            var myObj = new Object();
                                            myObj['message'] = "Something went wrong with social registration. Please try after sometime.";
                                            res.status(500).send(JSON.stringify(myObj));
                                        })
                                })
                                    .catch((executeErr) => {
                                        logger.error("executeErr>>>", executeErr);
                                        var myObj = new Object();
                                        myObj['message'] = "Unable to login you right now. Please try after some time.";
                                        res.status(500).send(JSON.stringify(myObj));
                                    })
                            }
                            else {
                                
                                var myObj = new Object();
                                myObj['message'] = "Email already taken, please try a different email.";
                                logger.error(myObj['message']);
                                if (!res.headersSent) {
                                    res.status(httpStatus.OK).end(JSON.stringify(myObj));
                                }
                            }

                        }
                    });
            })
            .catch((error) => {
                logger.error("ldap connection error occured" + error);
                var myObj = new Object();
                myObj['message'] = "Unable to connect you right now. Please try after some time.";
                res.status(500).send(JSON.stringify(myObj));
            })
        }
        else{
            logger.error("form vaidation error" + errorMessage);
            var myObj = new Object();
            myObj['message'] = "Please provide valid form values.";
            myObj['errorMessage'] = errorMessage;
            res.status(422).send(JSON.stringify(myObj));
        }
        
    }

});

/**
 * This method is used for resend verification link on
 * registered email if previous link has been expired
 * or user not used it for activate the account
 */
router.post('/resendLink', function (req, res) {
    let reqData = req.body;
    let uid = reqData.email;
    let filter = uid;
    let attributes = "uid,cn,sn,initials,employeeNumber"; //"mail,cn,uid,telephonenumber";

    var ldapFilter = "";
    var ldapAttributes = "";

    // Create the LDAP client
    FUNCTION.createClient()
        .then((client) => {
            // Set filter for search
            ldapFilter = '(uid=' + filter + ')';
            ldapAttributes = attributes.split(',');

            // Set the parameters for LDAP search
            let parameters = {
                filter: ldapFilter,
                scope: 'sub',
                attributes: ldapAttributes
            };
            logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+parameters);
            FUNCTION.serchUser(client, ldapStartDN, parameters)
                .then(function (result) {
                    /**
                     * serach for uid to confirm the user existence
                     */
                    
                    if (result[0] == undefined) {
                        res.status(401).send({ "msg": "This email address not registered with us. Please check you email address and try again." });
                    }
                    else {
                        let userData = result[0];

                        let uniqueID = '';

                        let dnArray = userData.dn.split(",");
                        if (dnArray[1].indexOf('ou=') > -1) {
                            var temp = dnArray[1].split("=");
                            uniqueID = temp[1];
                        }

                        var convertString = userData.uid + userData.cn + userData.sn;
                        var hashValue = FUNCTION.createhash(convertString);

                        var vrifyURL = config.siteurl + "/verifyaccount/" + hashValue + "/" + uniqueID;


                        let myObj = new Object();
                        var reqData = new Object();
                        reqData['firstname'] = userData['cn'];
                        reqData['lastname'] = userData['sn'];
                        reqData['email'] = uid;

                        FUNCTION.registerEmail(reqData)
                            .then((emailRes) => {
                                const currentTime = new Date().getTime();
                                const clientDN = userData.dn;
                                var change = new ldap.Change({
                                    operation: 'replace',
                                    modification: {
                                        employeeNumber: [currentTime]
                                    }
                                });
                                //modifies the detail i.e. current time for checking varification link expiry
                                FUNCTION.modifyUser(client, clientDN, change)
                                    .then(function (response) {
                                        res.status(200).send({ "msg": "Account verification link has been sent successfully." });
                                    })
                                    .catch(function (err) {
                                        logger.error("Unable to modified user time >>>", err);
                                        var myObj = new Object;
                                        myObj["message"] = "Unable to resend verification link. Please try after some time.";
                                        if (!res.headersSent) {
                                            res.status(200).send(myObj);
                                        }
                                    })
                            })
                            .catch((emailErr) => {
                                logger.error("email not sent>>", emailErr);
                                myObj.message = "Unable to resend verification link. Please try after some time.";
                                if (!res.headersSent) {
                                    res.status(200).send(JSON.stringify(myObj));
                                }
                            })

                        // const currentTime = new Date.getTime();



                    }
                })
                .catch(function (error) {
                    let myObj = new Object;
                    logger.error('Error while searching user in ldap--->'+ error);
                    myObj["messgae"] = "Sorry, we can not recognize you right now. Please try after some time.";
                    if (!res.headersSent) {
                        res.status(401).send(myObj);
                    }
                });
        })
        .catch((error) => {
            logger.error("ldap connection error occured in resendLink method", error);
            var myObj = new Object();
            myObj['message'] = "Unable to connect you right now. Please try after some time.";
            res.status(500).send(JSON.stringify(myObj));
        });
});

/**
 * This API will call when user click on verification link 
 * and after matching all information will activate
 * user account
 */
router.post('/accountVerification', function (req, res) {
    let reqData = req.body;
    
    let uuid = reqData.uuid;
    let hashValue = reqData.hashValue;
    let filter = uuid;
    let attributes = "uid,cn,sn,initials,employeeNumber,userPassword"; //"mail,cn,uid,telephonenumber";

    var ldapFilter = "";
    var ldapAttributes = "";

    // Create the LDAP client
    FUNCTION.createClient()
        .then((client) => {
            // Set filter for search
            ldapFilter = '(ou=' + filter + ')';//filter.split(',');
            ldapAttributes = attributes.split(',');

            // Set the parameters for LDAP search
            let parameters = {
                filter: ldapFilter,
                scope: 'sub',
                attributes: ["*"]
            };

            /**
             * Now serach for uid with startDN DN
             */
            parameters = {
                filter: '(uid=' + uuid + ')',
                scope: 'sub',
                attributes: ldapAttributes
            };
            FUNCTION.serchUser(client, ldapStartDN, parameters)
                .then(function (searchResult) {

                    let userData = searchResult[0];
                    let createdTime = parseInt(userData.employeeNumber);

                    let currentTime = new Date().getTime();

                    let hours = Math.abs((currentTime - createdTime) / 3600000);

                    if (hours > config.linkexpirationHours) {

                        let myObj = new Object;
                        myObj["message"] = "Your verification link has been expired.";
                        myObj['linkexpire'] = 1;
                        if (!res.headersSent) {
                            res.status(200).send(myObj);
                            return;
                        }
                    }
                    
                    if (userData.initials == 't') {
                        let myObj = new Object;
                        myObj["message"] = "Your account already verified.";
                        myObj['linkexpire'] = 0;
                        if (!res.headersSent) {
                            res.status(200).send(myObj);
                        }
                    }
                    else {

                        let createHashString = userData.uid + userData.cn + userData.sn;
                        var userhashValue = FUNCTION.createhash(createHashString);
                        var searchingDN = userData.dn;
                        if (userhashValue == hashValue) {
                            /**
                             * if hashvalue matched with given hash then update user status
                             * set initials as 't' for that user
                             * set newDN and change object for ldap changes
                             */

                            let change = new ldap.Change({
                                operation: 'replace',
                                modification: {
                                    initials: ['t']
                                }
                            });
                            /**
                             * Modify user in ldap
                             */
                            FUNCTION.modifyUser(client, searchingDN, change)
                                .then(function (response) {
                                    FUNCTION.sendPasswordEmail(userData)
                                        .then(emailRes => {
                                            let myObj = new Object();
                                            myObj["message"] = "Account verified successfully.";
                                            if (!res.headersSent) {
                                                res.status(200).send(myObj);
                                            }
                                        })
                                        .catch(emailErr => {
                                            logger.error("sending error in email>>>"+ emailErr);
                                            let myObj = new Object();
                                            myObj["message"] = "Some error occured in sending email.";
                                            if (!res.headersSent) {
                                                res.status(401).send(myObj);
                                            }
                                        });

                                })
                                .catch(function (err) {
                                    logger.error("err while modifying user detail>>"+ err);
                                    let myObj = new Object();
                                    myObj["message"] = "Some error occured in account activation. Please check the link.";
                                    myObj['linkexpire'] = 1;
                                    if (!res.headersSent) {
                                        res.status(401).send(myObj);
                                    }
                                })

                        }
                        else {
                            logger.error("Invalid verification link.");
                            let myObj = new Object();
                            myObj["message"] = "This is not a valid link. Please check your email for valid varification link";
                            myObj['linkexpire'] = 1;
                            if (!res.headersSent) {
                                res.status(401).send(myObj);
                            }
                        }
                    }

                })
                .catch(function (err) {
                    let myObj = new Object;
                    logger.error('Error while searching user in ldap>>>'+ err);
                    myObj["message"] = "Sorry, this verification link is not attached with any account.";
                    myObj['linkexpire'] = 1;
                    if (!res.headersSent) {
                        res.status(401).send(myObj);
                    }
                });
        })
        .catch((error) => {
            logger.error("ldap connection error occured in accountVerification method"+ error);
            var myObj = new Object();
            myObj['message'] = "Unable to connect you right now. Please try after some time.";
            res.status(500).send(JSON.stringify(myObj));
        });
});

/**
 * This API use by user in case of forgot password 
 * user will enter the registered email and an email  
 * send to that email with reset password instruction and link
 */
router.post('/forgotPassword', function (req, res) {
    var validator = require('validator');
    var formValid = true;
    var errorMessage ={};

    let reqData = req.body;
    let uuid = reqData.email;
    // logger.info("reqData>>>>", reqData);
    let filter = uuid;
    let attributes = "uid,cn,sn,initials,employeeNumber,userPassword,employeeType";

    var ldapFilter = "";
    var ldapAttributes = "";
    
    if(!validator.isEmail(uuid)){
        formValid = false;
        errorMessage['email'] ="Please provide valid email.";
    }

    if(formValid){
        // Create the LDAP client
        FUNCTION.createClient()
        .then((client) => {

            // Set filter for search
            ldapAttributes = attributes.split(',');

            parameters = {
                filter: '(uid=' + filter + ')',
                scope: 'sub',
                attributes: ldapAttributes
            };
            logger.info("Searching user with ldapStartDN="+ldapStartDN+", parameters="+parameters );
            FUNCTION.serchUser(client, ldapStartDN, parameters)
                .then(function (searchResult) {
                    if (searchResult.length == 0) {
                        logger.info("Account not exists for given email.");
                        let myObj = new Object();
                        myObj["message"] = "If a Connect account exists for " + uuid + ", an e-mail will be sent for the next steps.";

                        if (!res.headersSent) {
                            res.status(200).send(myObj);
                        }
                    }
                    else {
                        let userData = searchResult[0];
                        let userDN = userData.dn;
                        
                        if (userData.employeeType !== 'ldap') {
                            logger.info("Social user can not use forgot password.")
                            let myObj = new Object;
                            myObj["message"] = "Social signup user can not use forgot password.";
                            myObj['linkexpire'] = 0;
                            if (!res.headersSent) {
                                res.status(500).send(myObj);
                            }

                        }
                        else if (userData.initials === 'f') {
                            logger.info("User account is not active yet.");
                            let myObj = new Object;
                            myObj["message"] = "Please verify your account first before changing the password.";
                            myObj['linkexpire'] = 0;
                            if (!res.headersSent) {
                                res.status(401).send(myObj);
                            }
                        }
                        else {
                            let currentTime = new Date().getTime();

                            var timeChange = new ldap.Change({
                                operation: 'replace',
                                modification: {
                                    employeeNumber: [currentTime]
                                }
                            });
                            userData.currentTime = currentTime;
                            /** update labeld URI */
                            // updateRecords = Promise.all(FUNCTION.modifyUser(client, userDN, change),
                            FUNCTION.modifyUser(client, userDN, timeChange)
                                .then((result) => {
                                    FUNCTION.resetPasswordEmail(userData)
                                        .then(emailRes => {
                                            let myObj = new Object();
                                            myObj["message"] = "If a Connect account exists for " + uuid + ", an e-mail will be sent with further instructions.";
                                            if (!res.headersSent) {
                                                res.status(200).send(myObj);
                                            }
                                        })
                                        .catch(emailErr => {
                                            logger.error("Error while sending email>>>", emailErr);
                                            let myObj = new Object();
                                            myObj["message"] = "Some error occured in sending email.";
                                            if (!res.headersSent) {
                                                res.status(401).send(myObj);
                                            }
                                        });
                                })
                                .catch((error) => {
                                    logger.error("Error while modifying user>>"+error);
                                    var myObj = new Object;
                                    myObj["message"] = "Some error occured in process. Please try after some time";
                                    if (!res.headersSent) {
                                        res.status(401).send(myObj);
                                    }
                                });
                        }
                    }

                })
                .catch(function (err) {
                    let myObj = new Object;
                    logger.error('error while searching user>>>'+ err);
                    myObj["message"] = "Unable to complete your request right now. Please try after some time.";
                    myObj['linkexpire'] = 1;
                    if (!res.headersSent) {
                        res.status(401).send(myObj);
                    }
                });
        })
        .catch((error) => {
            logger.error("ldap connection error occured in forgorpassword method>>>"+ error);
            var myObj = new Object();
            myObj['message'] = "Unable to connect you right now. Please try after some time.";
            res.status(500).send(JSON.stringify(myObj));
        })
    }
    else{
        logger.error("form is not valid>>>");
        var myObj = new Object();
        myObj['message'] = "Please provide valid form values.";
        myObj['errorMessage'] = errorMessage;
        res.status(422).send(JSON.stringify(myObj));
    }
});
/*
***this API is use to get country code for contact 
field in registration form. 
***USER will get all conutry code.
*/

router.get('/getcountrycode', function (req, res) {
    try {
        let result = countryTelephoneData.allCountries;
        var list = [];
        for (let obj of result) {
            let new_item = {
                "displayname": (obj.iso2).toUpperCase() + " " + "(+" + obj.dialCode + ")",
                "savedValue": (obj.iso2).toUpperCase() + "+" + obj.dialCode,
                "passedValue": obj.name
            }
            list.push(new_item);
        }
        res.send(list);
    }
    catch (err) {
        var errors = {}
        var message = `Error /getcountrycode, error: ${err}`;
        errors.error = message;
        errors.description = "Fail to get code "
        logger.error(`GET /getcountrycode ${message} stackTrace: ${err.stack}`);
        return res.status(500).send(JSON.stringify(errors));
    }

})


/**
 * This is dummy api which use for to check some test cases
 */

router.get('/search/:domain', function (req, res) {
    try {
        function checkdomain(dm)
        {
            console.log(">>..", dm)
        }
        const businesscat = require('../config/businesscategory.json');
        let domain = req.params.domain;
        let accountMap = businesscat.accountMapping;
        let result = JSON.stringify(businesscat.accountMapping);
        // var abc = accountMap.findIndex(obj =>{
        //     obj[domain];
        // });

        var filteredObj = accountMap.find(function(item, i){
            logger.info("item >>>"+JSON.stringify(item));
            logger.info("i value >>>"+i);
            // return item['domain'] === domain 
            //if(item[domain] === domain ){
                if(domain in item){
                    
                // var category = item["category"];
                    console.log("domainf>>>", item[domain]);
                    let domainVal = item[domain];
                //   index = i;
                    return domainVal;
                   
                }
          });
        
        logger.info("abc >>>"+JSON.stringify(filteredObj));
        var getvalue = filteredObj[domain];
        logger.info("getvalue >>>"+getvalue);
        // for (var name in accountMap) {
        //     logger.info("name >>>"+name);
        //     // if (name === domain) {
        //       //result.push({name: name, goals: goals[name]});
        //       logger.info("domain list N value >>>"+accountMap[name][domain]);
        //     // }
        //   }

        // if(result.includes(domain)){
        //     logger.info("business category >>>"+result[domain]);
        // }
        res.send(result);
        logger.info("account mapping >>>>"+JSON.stringify(businesscat.accountMapping));
        /** Create the LDAP client*/
        // FUNCTION.createClient()
        // .then( (client)=>{
        //     // var userDN = 'ou=vipin.sati@robomq.io,ou=technology,o=robomq.io,dc=robomq,dc=io';
        //     // var userDN = 'ou=gurpreet@mailinator.com,ou=technology,o=mailinator.com,dc=example,dc=com';
        //     var userDN = 'ou=gurpreet@mailinator.com,ou=technology,o=mailinator.com,dc=robomq,dc=io';
        //     var change = new ldap.Change({
        //         operation: 'replace',
        //         modification: {
        //             businessCategory: ['employee']
        //         }
        //     });
            
        //     FUNCTION.modifyUser(client, userDN, change)
        //     .then( result => {
        //         logger.info("result>>>"+result);
        //     })
        //     .catch( error => {
        //         logger.info("error>>>"+error);
        //     })
        // })
        // .catch( error => {
        //     logger.info("client error>>>"+error);
        // })
        // logger.info("this is test api");
    }
    catch (e) {
        logger.info("catching error>>>>"+ e);
    }

});
module.exports = router;
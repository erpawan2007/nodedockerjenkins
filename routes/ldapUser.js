var ldap = require('ldapjs');
var express = require('express');
var router = express.Router();
var async = require('async');
var config = require('../config/config.json');
var FUNCTION = require('../function.js');

const ldapStartDN = config.ldapDetails.base;
var fname, lname, email, contact, o, ou, uid, uuid, newDN1, userPassword, oldPasswd, newPasswd;

/**
 * This method Update the user information 
 *  like first name, last name, phone number and password
 */
router.put('/', async function (req, res) {
	logger.info("Update profile req body>>>>"+JSON.stringify(req.body));
	var validator = require('validator');
	var reqData = req.body;
    var formValid = true;
	var errorMessage ={};
	
	var regex = /[a-zA-Z][^!@#&<>\"~;$^%{}?0-9]{1,20}$/;
	// logger.info("matching first name>>>>"+regex.test(reqData.firstname));
	// logger.info("matching last name>>>>"+regex.test(reqData.lastname));


	if(validator.isEmpty(reqData.firstName) || !regex.test(reqData.firstName)){
		formValid = false;
		errorMessage['firstname']="Please provide valid first name.";
	}
	logger.info("errorMessage>>>>"+errorMessage);
	if(validator.isEmpty(reqData.lastName) || !regex.test(reqData.lastName)){
		formValid = false;
		errorMessage['lastname']="Please provide valid last name.";
	}

	logger.info("formValid>>>>"+formValid);

	if(formValid){
		// Create the LDAP client
		FUNCTION.createClient()
		.then( (client)=>{
			//route for changing personal details
			fname = req.body.firstName;
			lname = req.body.lastName;
			contact = req.body.contact;
			uid = req.body.uid;
			var attributes = "uid,cn,sn,mobile";
			logger.info("body>>>", req.body);

			const ldapFilter = '(uid=' + uid + ')';
			const ldapAttributes = attributes.split(',');
			// Set the parameters for LDAP search
			var parameters = {
				filter: ldapFilter,
				scope: 'sub',
				attributes: ldapAttributes
			};
			
			// callback(null, result);
			logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+JSON.stringify(parameters));
			FUNCTION.serchUser(client, ldapStartDN, parameters)
			.then(function (searchResult) {
				if(searchResult.length == 0){
					let myObj = new Object();
					myObj["message"]="User account is not exist. Please check your credentials and login again.";
					
					if(!res.headersSent){
						res.status(200).send(myObj);
					}
				}
				else{
					let userData = searchResult[0];
					let userDN = userData.dn;
					
					var change = new ldap.Change({
						operation: 'replace',
						modification: {
							cn: [fname]
						}
					});
					var change1 = new ldap.Change({
						operation: 'replace',
						modification: {
							sn: [lname]
						}
					});
					
					var promise1 = FUNCTION.modifyUser(client, userDN, change);
					var promise2 = FUNCTION.modifyUser(client, userDN, change1);
					var promise3 ='';
					// userData.mobile!=''
					if(contact!='' && contact!= undefined){
						let operationVal = 'replace';
						if(userData.mobile=='' || userData.mobile==undefined){
							operationVal = 'add';
						}

						var change2 = new ldap.Change({
							operation: operationVal,
							modification: {
								mobile: [contact]
							}
						});
						
						var promise3 = FUNCTION.modifyUser(client, userDN, change2);
					}
					else{
						if(userData.mobile!==undefined){
							var change2 = new ldap.Change({
								operation: 'delete',
								modification: {
									mobile: []
								}
							});
							
							var promise3 = FUNCTION.modifyUser(client, userDN, change2);
						}
					}
					
					
					Promise.all([promise1, promise2, promise3]).then((executeRes)=>{
						// resolve(executeRes);
						logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+JSON.stringify(parameters));
						FUNCTION.serchUser(client, ldapStartDN, parameters)
						.then(function (result) {
							// callback(null, result);
							var attr = result[0];
							var myObj = new Object;
							myObj["firstname"] = attr.cn;
							myObj["lastname"] = attr.sn;
							myObj["contact"] = attr.mobile;
							/** CU-626 Update hubspot contact */
							let hubspotContact = {
									method:"update",
									firstName: attr.cn,
									lastName: attr.sn,
									updateEmail: attr.uid,
									phone:attr.mobile
							}
							
							FUNCTION.createHubspotContact(JSON.stringify(hubspotContact))
							.then((createContactRes)=>{
									logger.info('createContactRes>>'+createContactRes);
							})
							.catch((createContactErr)=>{
									logger.info('createContactErr>>'+createContactErr);
							});
							if (!res.headersSent) {
								res.status(200).send(JSON.stringify(myObj));
							}
						})
						.catch(function (error) {
							logger.error("error while searcing user in ldap after modify>>>>"+ error);
							var myObj = new Object();
							myObj['message']="Unable to modify user information. Please try after some time.";
							res.status(500).send(JSON.stringify(myObj));
						})
					})
					.catch((executeErr)=>{
						logger.error("Error while modifying user information>>>"+ executeErr)
						var myObj = new Object();
						myObj['message']="Unable to modify user information. Please try after some time.";
						res.status(500).send(JSON.stringify(myObj));
					})
					
				}
			})
			.catch(function (error) {
				logger.error("Error while searching user for "+uid+ error);
				var myObj = new Object();
				myObj['message']="Unable to find user with current information. Please try after some time.";
				res.status(500).send(JSON.stringify(myObj));
			});
		})
		.catch( (error) => {
			logger.error("ldap connection error occured in update user information method"+ error);
			var myObj = new Object();
			myObj['message']="Unable to connect you right now. Please try after some time.";
			res.status(500).send(JSON.stringify(myObj));
		});
	}
	else{
		logger.error("Form is not valid");
		var myObj = new Object();
		myObj['message']="Please provide valid form values.";
		myObj['errorMessage']=errorMessage;
		res.status(422).send(JSON.stringify(myObj));
	}
});

router.put('/changeCredentials', function (req, res) {
	// logger.info("changeCredentials req body>>>>"+JSON.stringify(req.body));
	var validator = require('validator');
	var reqData = req.body;
    var formValid = true;
	var errorMessage ={};
	var currentSessionIDKey = "sess:"+req.query.sessionid;
	
	
	if(validator.isEmpty(reqData.oldPassword) || !validator.isLength(reqData.oldPassword, {"min":8, "max":16})){
		formValid = false;
		errorMessage['password'] ="Please provide valid old password.";
	}
	if(validator.isEmpty(reqData.newPassword) || !validator.isLength(reqData.newPassword, {"min":8, "max":16})){
		formValid = false;
		errorMessage['password'] ="Please provide valid new password.";
	}
	

	if(formValid){
		// Create the LDAP client
		FUNCTION.createClient()
		.then( (client)=>{
			//route which handle call for changing password
			oldPasswd = reqData.oldPassword;
			newPasswd = reqData.newPassword;
			confirmPasswd = reqData.confirmPassword;

			o = req.body.o;
			ou = req.body.ou;
			uid = req.body.uid;
			uuid = req.body.uuid;

			var attributes = "uid,userPassword";

			//the base DN is formed to change some details of a user account
			newDN1 = 'uid=' + uid + ',ou=' + uuid + ',ou=' + ou + ',o=' + o + ','+ldapStartDN;

			// Set filter for search
			ldapFilter = '(uid=' + uid + ')';
			ldapAttributes = attributes.split(',');
			// Set the parameters for LDAP search
			var parameters = {
				filter: ldapFilter,
				scope: 'sub',
				attributes: ldapAttributes
			};
		//searches for the user's old password to match with the password entered by user
		logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+JSON.stringify(parameters));
			FUNCTION.serchUser(client, ldapStartDN, parameters)
			.then(function (result) {
				var attr = result[0];
				userPassword = attr.userPassword;

				if (oldPasswd !== userPassword) {
					var myObj = new Object;
					myObj["message"] = 'Old Password does\'nt match';
					logger.error(myObj["message"]);
					if (!res.headersSent) {
						res.status(200).send(myObj);
					}
				}
				else {
					var change = new ldap.Change({
						operation: 'replace',
						modification: {
							userPassword: [newPasswd]
						}
					});
					logger.info('newDN1--->'+ newDN1);
					logger.info('newPasswd--->'+ newPasswd);
					
					//modifies the detail i.e. password of user
					FUNCTION.modifyUser(client, newDN1, change)
						.then(function (response) {
							var myObj = new Object;

							/** added line
							 * CU-274 remove user session from Redis after 
							 * password has been updated
							 * find sessions from sessions:pawan@mailinator.com
							 * and delete all active sessions key
							 * code block start
							 */
							var username = req.username;
							logger.info("username>>>"+req.username);
							var smembersKey = "sessions:" + username;
							rclient.smembers(smembersKey, function(err, sessionIds) {
								logger.info("sessionIds>>>"+JSON.stringify(sessionIds));
								if (sessionIds.length === 0){
									logger.error('could not delete session...sessionIds length: ' + sessionIds.length);
									var myObj = new Object();
									myObj.message = "Something is wrong here. Please try after some time.";
									res.status(401).end(JSON.stringify(myObj));
								}
								else{
									logger.info('currentSessionIDKey---->'+ currentSessionIDKey);
									logger.info('Current INDEX--->'+sessionIds.indexOf(currentSessionIDKey));
									/** 
									 * Delete all sessions except the current session
									 * through which user updating password
									 * splice the current session key from session ID response
									 */
									sessionIds.splice(sessionIds.indexOf(currentSessionIDKey), 1);
									logger.info('session ids after splice current session>>>>'+sessionIds);
									rclient.del.apply(rclient, sessionIds);
									sessionIds.forEach(element => {
										logger.info("elements--->"+element);
										rclient.srem(smembersKey, element);	
									});
									
									logger.info('session ids after deleting>>>>'+sessionIds);
									// Delete the set containing now deleted session IDs
									// rclient.del("sessions:" + username);
									logger.info('session deleted in destroy function');
									var myObj = new Object();
									// myObj.msg = "session deleted. login back.";
									// res.status(200).end(JSON.stringify(myObj));
									myObj["message"] = "Password updated successfully.";
									res.status(200).send(myObj);
								}
							});
							/** code block end */
							
							
						})
						.catch(function (err) {
							var myObj = new Object;
							myObj["message"] = "Password not updated.";
							logger.error(myObj["message"]+">>>"+err)
							if (!res.headersSent) {
								res.status(200).send(myObj);
							}
						})
				}

			})
			.catch(function (error) {
				var myObj = new Object;
				myObj["message"] = "Password not updated.";
				logger.error("Error while searching user in ldap>>>"+error);
				if (!res.headersSent) {
					res.status(200).send(myObj);
				}
			});
		})
		.catch( (error) => {
			logger.error("ldap connection error occured in changeCredentials method", error);
			var myObj = new Object();
			myObj['message']="Unable to connect you right now. Please try after some time.";
			res.status(500).send(JSON.stringify(myObj));
		})
	}
	else{
		logger.error("Form is not valid");
		var myObj = new Object();
		myObj['message']="Please provide valid form values.";
		myObj['errorMessage']=errorMessage;
		res.status(422).send(JSON.stringify(myObj));
	}	
});

// router.post('/linkAcc', function (req, res) {
// 	// Create the LDAP client
// 	FUNCTION.createClient()
//     .then( (client)=>{	
// 		//this routes handles linking account to exixting user account
// 		fname = req.body.firstName;
// 		lname = req.body.lastName;
// 		email = req.body.email;
// 		mobile = req.body.mobile;
// 		employeeType = req.body.memberOf;

// 		o = req.body.o;
// 		ou = req.body.ou;
// 		uid = req.body.email;
// 		uuid = req.body.uuid;

// 		var filter = uid;
// 		var opts = {
// 			filter: '(uid=' + filter + ')',
// 			scope: 'sub',
// 			attributes: ['uid', 'sn', 'cn', 'businessCategory']
// 		};

// 		//the base DN is formed to add a user account
// 		var startDN = 'ou=' + uuid + ',ou=' + ou + ',o=' + o + ','+ldapStartDN;
// 		//searches the email must not existed to link
// 		logger.info("Searching user in ldap with startDN="+startDN+", options="+JSON.stringify(opts))
// 		FUNCTION.serchUser(client, startDN, opts)
// 		.then(function (resultSet) {
// 			// logger.info("result after resolve-->", resultSet);
// 			if (resultSet.length > 0) {
// 				var myObj = new Object;
// 				myObj["message"] = "Can't link existing account";
				
// 				if (!res.headersSent) {
// 					res.status(401).send(myObj);
// 				}
// 			}
// 			else {

// 				var newDN = 'uid=' + email + "," + startDN;
// 				const entry1 = {
// 					cn: fname,
// 					sn: lname,
// 					mail: email,
// 					objectclass: ['inetOrgPerson'],
// 					uid: email,
// 					mobile: mobile,
// 					employeeType: employeeType,
// 					title: "secondary"
// 				};
// 				//if the email is unique then it links to existing account
// 				FUNCTION.createNewUser(client, newDN, entry1)
// 					.then(function (result) {
// 						if (!res.headersSent) {
// 							res.status(200).send({ "message": "account has been linked" });
// 						}
// 					})
// 					.catch(function (err) {
// 						logger.error('Error while linking an account>>>'+ err);
// 						if (!res.headersSent) {
// 							res.status(500).send({ "message": err.message });
// 						}
// 					})

// 			}
// 		})
// 		.catch(function (err) {
// 			logger.error("Error while seaching user in ldap>>>"+ err);
// 			if (!res.headersSent) {
// 				res.status(500).send({ "message": "Unable to link account right now. Please try after some time." });
// 			}
// 		});
// 	})
//     .catch( (error) => {
//         logger.error("ldap connection error occured in link account method "+ error);
//         var myObj = new Object();
//         myObj['message']="Unable to connect you right now. Please try after some time.";
//         res.status(500).send(JSON.stringify(myObj));
//     });
// });

// router.post('/unlinkAcc', function (req, res) {

// 	// Create the LDAP client
// 	FUNCTION.createClient()
//     .then( (client)=>{
// 		//handles un-linking of the account
// 		o = req.body.o;
// 		ou = req.body.ou;
// 		uid = req.body.email;
// 		uuid = req.body.uuid;

// 		//the base DN is formed to delete a user account
// 		var startDN = 'uid=' + uid + ',ou=' + uuid + ',ou=' + ou + ',o=' + o + ','+ldapStartDN;

// 		//delete the account if user makes a call to unlink that account
// 		FUNCTION.deleteUser(client, startDN)
// 		.then(function (result) {
// 			res.status(200).send({ "message": "account has been unlinked" });
// 		})
// 		.catch(error => {
// 			logger.error("Error while deleting the linked account>>>"+error);
// 			var myObj = new Object();
// 			myObj['message']="Unable to unlink account. Please try after some time.";
// 			res.status(500).send(JSON.stringify(myObj));
// 		});
// 	})
//     .catch( (error) => {
//         logger.error("ldap connection error occured in unlinkaccount method"+ error);
//         var myObj = new Object();
//         myObj['message']="Unable to login you right now. Please try after some time.";
//         res.status(500).send(JSON.stringify(myObj));
//     })		

// });

router.post('/accountsetting', function (req, res) {
	logger.info("-----------------accountsetting api-----------------");
	// Create the LDAP client
	FUNCTION.createClient()
    .then( (client)=>{
		let reqData = req.body;
		let uuid = reqData.username;

		let filter = uuid;
		let attributes = "uid,cn,sn,initials,employeeNumber,userPassword,employeeType,title,mobile,o";

		var ldapFilter = "";
		var ldapAttributes = "";
		// Set filter for search
		ldapAttributes = attributes.split(',');

		parameters = {
			filter: '(uid=' + filter + ')',
			scope: 'sub',
			attributes: ['*']
		};
		logger.info("searching user with ldapStartDN="+ldapStartDN+", parameters="+JSON.stringify(parameters));
		FUNCTION.serchUser(client, ldapStartDN, parameters)
		.then(function (searchResult) {
			let myObj = new Object();
			if (searchResult.length == 0) {

				myObj["message"] = "No result found for this user.";
				if (!res.headersSent) {
					res.status(401).send(myObj);
				}
			}
			else{
				var user = searchResult[0];
				var attr = user.dn.split(","); // split the dn on '.'
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
				myObj.memberOf = user.employeeType;
				myObj.employeeNumber = user.employeeNumber;
				myObj.vhost = vhost[1];
				myObj.company = user.o;
				res.setHeader('Access-Control-Allow-Origin', '*');
				sess = req.session;
				sess.username = myObj.uid;
				// sess.password = req.body.password;
				sess.o = myObj.o;
				sess.ou = myObj.ou;
				sess.uuid = myObj.uuid;
				sess.uid = myObj.uid;
				sess.vhost = vhost[1];
				sess.session_id = req.sessionID;
				res.set("Content-Type", "application/json");
				myObj.sessionId = sess.session_id;


				if (reqData.memberOf == 'ldap') {
					/**  getLinkedAccount  detail*/
					searchParameters = {
						filter: '!(employeeType=ldap)',
						scope: 'one',
						attributes: ldapAttributes
					};
					/**
					 * split DN on first occureence of comma
					 * it will remove the uid from dn string
					 */
					var searchDN = user.dn.split(/,(.+)/)[1];
					/**
					 * Perform the search under OU=UUID for all linked account 
					 */
					logger.info("searching user with searchDN="+searchDN+", searchParameters="+JSON.stringify(searchParameters));
					FUNCTION.serchUser(client, searchDN, searchParameters)
						.then(function (entry) {

							myObj.socialAccounts = entry;
							if (entry.length > 0 && entry[0].employeeType == 'google') {
								myObj.linkedAccount = 'yes';
							} else {
								myObj.linkedAccount = 'no';
							}
							if (!res.headersSent) {
								res.status(200).end(JSON.stringify(myObj));
							}
						})
						.catch(function (err) {
							logger.error("error while searching linked account in ldap>>>>"+ error);
							let myObj = new Object;
							myObj["message"] = "Something went wrong. Please try after some time.";
							if (!res.headersSent) {
								res.status(401).send(myObj);
							}
						})
				}
				else {
					res.status(200).end(JSON.stringify(myObj));
				}
			}
			

		})
		.catch(function (error) {
			logger.error("Error while searching user in ldap for fetching account info>>>>"+ error);
			let myObj = new Object;
			myObj["message"] = "Unable to find user with current information. Please try after some time.";
			if (!res.headersSent) {
				res.status(401).send(myObj);
			}
		});
	})
    .catch( (error) => {
        logger.info("ldap connection error occured in accountsetting method "+ error);
        var myObj = new Object();
        myObj['message']="Unable to connect you right now. Please try after some time.";
        res.status(500).send(JSON.stringify(myObj));
    })
});

router.get('/checksession', function(req, res){
	logger.info('checksession api called')
	var myObj = new Object();
	if (req.query.sessionid) {
		var sessionID = req.query.sessionid;
		logger.info("checksession: Session ID is = " + sessionID);
		var key = "sess:" + sessionID;
		rclient.get(key, function (err, response) {
			if(!err) {
			  if(response!=null){
				var result = JSON.parse(response);
				req.username = result.username;
				req.vhost = result.o;
				myObj['session_exist'] = true;
				myObj['message'] = "Session exist";
				res.status(200).send(myObj);
			  }
			  else{
				myObj['message'] = "no content found";
				myObj['session_exist'] = false;
				res.status(204).send(myObj);
			  }
			  
			} else{
				logger.error("Error : " + err);
				myObj['session_exist'] = false;
			  	myObj['message'] = "You are not authorize to perform this action. Please login again."
				res.status(401).send(errorMsg);
			}
		})
	}
	else{
		logger.error("Error : " + err);
		myObj['session_exist'] = false;
		myObj['message'] = "You are not authorize to perform this action. Please login again."
		res.status(401).send(errorMsg);
	}
})
// router.post('/deleteaccount', function (req, res) {
// 	FUNCTION.createClient()
//     .then( (client)=>{
// 		var reqData = req.body;
// 		var attributes = "uid";

// 		ldapFilter = '(uid=' + reqData.uid + ')';//filter.split(',');
//         ldapAttributes = attributes.split(',');
//         // Set the parameters for LDAP search
//         var parameters = {
//             filter: ldapFilter,
//             scope: 'sub',
//             attributes: ldapAttributes
//         };
// 		const uid = reqData.uid;	
// 		FUNCTION.serchUser(client, ldapStartDN, parameters)
// 		.then( searchResult =>{
// 			if (searchResult.length == 0) {
// 				let myObj = new Object();
// 				myObj["message"] = "No result found for this user.";
// 				res.status(401).send(myObj);
// 			}
// 			else{
// 				const promise1 = FUNCTION.rollbackUserRegistration(client, uid)
// 				const promise2 = FUNCTION.deleteRedisUser(uid);
// 				Promise.all([promise1, promise2])
// 				.then((executeRes)=>{
// 					logger.info("user account deleted ");
// 					var myObj = new Object();
// 					myObj['message']="User account deleted.";
// 					res.status(200).send(JSON.stringify(myObj));
// 				})
// 				.catch(executeErr => {
// 					logger.error("error occured while removing user account", error);
// 					var myObj = new Object();
// 					myObj['message']="Unable to delete account. Please try after some time.";
// 					res.status(500).send(JSON.stringify(myObj));
// 				})
// 			}
// 		})
// 		.catch( error =>{
// 			logger.error("error occured search user failed", error);
// 			var myObj = new Object();
// 			myObj['message']="Unable to find account. Please try after some time.";
// 			res.status(500).send(JSON.stringify(myObj));
// 		});


// 	})
// 	.catch( (error) => {
//         logger.error("ldap connection error occured", error);
//         var myObj = new Object();
//         myObj['message']="Unable to login you right now. Please try after some time.";
//         res.status(500).send(JSON.stringify(myObj));
//     })
// });

// router.post('/getkey', function (req, res) {
// 	var reqData = req.body;

// 	const uid = username = reqData.uid;
// 	const getOrg = uid.split('@');
// 	const customeKey = getOrg[1]+":profile";
// 	logger.info("customeKey>>>", customeKey);
// 	FUNCTION.getKey(customeKey)
// 	.then( result =>{
// 		logger.info("result>>>>", result);
// 		const jsObj = JSON.parse(result);
// 		const orgUsers = jsObj['user'];
// 		const orgName = jsObj['name'];
// 		logger.info("orgUsers before loop >>>", orgUsers);
// 		for(var i=0; i< jsObj['user'].length; i++){
// 			logger.info("user record>>", jsObj['user'][i]['username']);
// 			if(jsObj['user'][i]['username']==username){
// 				// userProfile=profile['user'][i];
// 				logger.info("index value >>>"+ i);
// 				// delete orgUsers[i];
// 				orgUsers.splice(i, 1);
// 				break;
// 			}
// 		}
// 		logger.info("orgUsers after loop >>>", JSON.stringify(orgUsers));
// 		let info = new Object();
// 		info['name']=orgName;
// 		info['user']=orgUsers;
// 		FUNCTION.setKey(customeKey, info)
// 		.then((setkeyRes)=>{
// 			var myObj = new Object();
// 			myObj['message']="key set.";
// 			res.status(200).send(JSON.stringify(myObj));
// 		})
// 		.catch((setkeyErr)=>{
// 			logger.error("ldap connection error occured in link account method "+ error);
// 			var myObj = new Object();
// 			myObj['message']="setkey success.";
// 			res.status(500).send(JSON.stringify(myObj));
// 		})
// 	})
// 	.catch( error => {
// 		logger.error("error while searching in redis>>", error);
// 		var myObj = new Object();
//         myObj['message']="Unable to connect you right now. Please try after some time.";
//         res.status(500).send(JSON.stringify(myObj));
// 	});
// });
module.exports = router;
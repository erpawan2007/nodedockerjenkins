############################################################
# Dockerfile for building image for IFD BE
# Based on node:alpine
############################################################

FROM node:alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./

RUN apk --no-cache --virtual build-dependencies add \
	python \
	make \
	&& npm install 

# Bundle app source
COPY . .

CMD [ "npm", "start" ]

pipeline {
    agent { docker { image 'node:10.15.0-alpine' } }
    stages {
        stage('Build') {
            steps {
                sh 'echo "Build Started"'
                
            }
        }
    }
}


pipeline {
    agent { dockerfile true }
    stages {
	stage('Build') {
            steps {
                sh 'echo "Build Started"'
                
            }
        }
        stage('Test') {
            steps {
                sh 'node --version'
                sh 'svn --version'
            }
        }
    }
}

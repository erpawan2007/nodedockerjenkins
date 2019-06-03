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

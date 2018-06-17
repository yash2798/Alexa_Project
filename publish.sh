\rm -fr lambda_upload.zip 
zip -r lambda_upload.zip index.js node_modules  
aws lambda update-function-code --function-name Mail_Skill --zip-file fileb://lambda_upload.zip

rm lambda.zip
zip -r lambda.zip ./index.mjs node_modules ./package.json ./package-lock.json

aws lambda update-function-code --function-name lambdaName \
--zip-file fileb://~/workspace/lambda/lambda.zip \
--region me-central-1
## Remove Existing zip file ##
`rm send-match-result.zip`

## Deploy to AWS Lambda ##
`zip -r send-match-result.zip ./index.mjs assets fonts`

`aws lambda update-function-code --function-name send-match-result \
--zip-file fileb://~/workspace/sport-broadcaster/send-match-result.zip \
--region me-central-1`

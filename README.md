rm send-match-result.zip
zip -r send-match-result.zip ./index.mjs assets

aws lambda update-function-code --function-name send-match-result \
--zip-file fileb://~/workspace/sport-broadcaster/send-match-result.zip \
--region me-central-1
import AWS from 'aws-sdk';
import { log } from 'console';
import Fotmob from 'fotmob';
const fotmob = new Fotmob.default();
AWS.config.update({ region: 'me-central-1' });
import { TelegramClient } from "telegram";
import { sessions } from "telegram";
const StringSession = sessions.StringSession;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Lambda function code
export const handler = async (event) => {
  console.log('Event: ', event);
  const leagueId = event.leagueId; 

  const matches = await fotmob.getMatchesByDate(nowStr());
  const mappedMatches = mapMatches(matches, leagueId);

  try {
    const iterations = 6; // Number of times to log messages
    const intervalInSeconds = 10; // Interval in seconds between each log
    let promises = [];

    for (let i = 0; i < iterations; i++) {
      // Wrap setTimeout in a Promise
      let promise = new Promise((resolve) => {
        setTimeout(async () => {
          for (const match of mappedMatches) {
            console.log('Match: ', match);
            if(!match.status.started) {
                console.log("Match has not started yet. Skipping...");
                continue;
            }

            // Check whether process before
            const params = {
              TableName: 'MATCH_STATUS',
              Key: {
                  match_id: match.id
              }
            };
            const dbResult = await dynamoDb.get(params).promise();
            const currentStatus = dbResult.Item ? dbResult.Item.status : 'UNPROCESSED';

            if (currentStatus === 'PROCESSED') {
              console.log("Match has been processed before. Skipping...");
              continue;
            }

            if (currentStatus === 'UNPROCESSED' && !!match.status.finished) {
              console.log("Match has finished. Processing...");
              await updateDb(match.id);
              await sendMessage(match.status.scoreStr, match.home.name, match.away.name);
            } else {
              console.log("Match is still ongoing. Skipping...");
            }
          }
          resolve(); // Resolve the promise after the timeout
        }, i * intervalInSeconds * 1000);
      });
      promises.push(promise);
    }
    await Promise.all(promises);
  } catch (error) {
      console.error("Error: ", error);
  }
  return "Completed.";
};


const nowStr = () => {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  const yyyy = today.getFullYear();
  return yyyy + mm + dd;
}

const mapMatches = (matches, leagueId) => {
  const filteredMatches = matches?.leagues
    ?.filter(league => league.primaryId === leagueId) // 50 for euros
    ?.flatMap(league => league.matches)
    ?.map(match => ({
        id: match?.id,
        time: match?.time,
        home: {
            name: match?.home?.name,
            score: match?.home?.score
        },
        away: {
            name: match?.away?.name,
            score: match?.away?.score
        },
        status: {
            started: match?.status?.started,
            finished: match?.status?.finished,
            cancelled: match?.status?.cancelled,
            scoreStr: match?.status?.scoreStr
        },
        eliminatedTeamId: match?.eliminatedTeamId
    }));
  return filteredMatches;
}

const updateDb = async (id) => {
  const updateParams = {
    TableName: 'MATCH_STATUS',
    Key: {
      match_id: id
    },
    UpdateExpression: 'set #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'PROCESSED'
    }
  };
  await dynamoDb.update(updateParams).promise();
}

const sendMessage = async (scoreStr, homeTeam, awayTeam) => {
  const apiId = process.env.API_ID;
  const apiHash = process.env.API_HASH;
  const stringSession = process.env.STRING_SESSION
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  
  try {
    if (!client.connected) {
      console.log('Connecting to telegram');
      await client.connect();
    }
    await client.sendMessage('@trystan_loke', { message: `${homeTeam} ${scoreStr} ${awayTeam} ` });
  } catch (error) {
    throw 'Error sending message';
  }
}

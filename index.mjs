import AWS from 'aws-sdk';
import Fotmob from 'fotmob';
const fotmob = new Fotmob.default();
AWS.config.update({ region: 'me-central-1' });
import { TelegramClient, sessions} from "telegram";
const StringSession = sessions.StringSession;
const dynamoDb = new AWS.DynamoDB.DocumentClient();
import fs from "fs";
import { Api } from "telegram";
import { CustomFile } from 'telegram/client/uploads.js';
import sharp from 'sharp';
import fetch from 'node-fetch';
import translate from "translate";

let language = "english"; // Default language
// Lambda function code
export const handler = async (event) => {
  console.log('Event: ', event);
  const leagueId = event.leagueId; 
  language = event.language || "english"; 
  

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
              match.home.logo = await retrieveTeamLogo(match.home.id);
              match.away.logo = await retrieveTeamLogo(match.away.id);
              await updateDb(match.id);
              await sendMessage(match.id, match.statusId, match.home, match.away);
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
            id: match?.home?.id,
            name: match?.home?.name,
            score: match?.home?.score
        },
        away: {
            id: match?.away?.id,
            name: match?.away?.name,
            score: match?.away?.score
        },
        statusId: match?.statusId,
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

const sendMessage = async (matchId, statusId, homeTeam, awayTeam) => {
  console.log('Env: ', process.env);
  const apiId = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;
  const stringSession = new StringSession(process.env.STRING_SESSION);
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  const peerId = process.env.CHAT_ID || process.env.RECEIVER_TAG
  
  try {
    if (!client.connected) {
      console.log('Connecting to telegram');
      await client.connect();
    }

    await generateResultImage('./assets/score-background.jpeg', '/tmp/output.jpg', homeTeam.name, awayTeam.name, homeTeam.score, awayTeam.score, statusId === 6 ? '90:00' : '120:00', homeTeam.logo, awayTeam.logo, 'white');

    const result = await client.invoke(
    new Api.messages.SendMedia({
      peer: peerId,
      media: new Api.InputMediaUploadedPhoto({
        file: await client.uploadFile({
          file: new CustomFile(
            "output.jpg",
            fs.statSync("/tmp/output.jpg").size,
            "/tmp/output.jpg"
          ),
          workers: 1,
        }),
      }),
      message: "",
      randomId: matchId, // To prevent resending the same message
    })
  );
  } catch (error) {
    console.log('Error: ', error);
    return error; 
  }
}

const getTeamLogo = async (teamId) => {
  const teams = await fotmob.getTeams();
  const team = teams.find(team => team.name === teamName);
  return team.logo;
}

async function generateResultImage(
  backgroundImagePath,
  outputImagePath,
  homeTeamName,
  awayTeamName,
  homeScore,
  awayScore,
  fullTime,
  homeLogoUrl,
  awayLogoUrl,
  fontColor // Example: 'white' or '#ffffff'
) {
  try {
    // Resize and overlay country flag image
    const homeLogoBuffer = await fetch(homeLogoUrl)
      .then(res => res.buffer())
      .then(buffer => sharp(buffer).resize({ width: 300 }).toBuffer());
    const awayLogoBuffer = await fetch(awayLogoUrl)
      .then(res => res.buffer())
      .then(buffer => sharp(buffer).resize({ width: 300 }).toBuffer());

    // Use Sharp to create a new image with text overlay
    const timeBaseX = 700;
    const adjustmentPerCharacter = 30;
    const lengthAdjustment = (fullTime.length - 5) * adjustmentPerCharacter / 2; // Adjusting for half, as we want to keep it centered
    const adjustedX = timeBaseX - lengthAdjustment;

    await sharp(backgroundImagePath)
      .composite([
        { input: homeLogoBuffer, top: 240, left: 50 },
        { input: awayLogoBuffer, top: 240, left: 1210 },
        { 
          input: Buffer.from(`<svg>
            <rect x="0" y="0" width="400" height="150" fill="rgba(0, 0, 0, 0)"/>
            <text x="450" y="145" font-family="Impact" font-size="40" fill="${fontColor}">
              ${await translateText(homeTeamName)}
            </text>
            <text x="870" y="145" font-family="Impact" font-size="40" fill="${fontColor}">
              ${await translateText(awayTeamName)}
            </text>
            <text x="530" y="370" font-family="Impact" font-size="128" fill="${fontColor}">
              ${homeScore}
            </text>
            <text x="760" y="370" font-family="Impact" font-size="128" fill="${fontColor}">
              -
            </text>
            <text x="960" y="370" font-family="Impact" font-size="128" fill="${fontColor}">
              ${awayScore}
            </text>
            <text x="745" y="465" font-family="Impact" font-size="32" fill="${fontColor}">
              ${await translateText("Time")}
            </text>
            <text x="${adjustedX}" y="550" font-family="Impact" font-size="64" fill="${fontColor}">
              ${fullTime}
            </text>
            <text x="550" y="528" font-family="Impact" font-size="32" fill="${fontColor}">
               ${await translateText("Home Team")}
            </text>
            <text x="948" y="528" font-family="Impact" font-size="32" fill="${fontColor}">
               ${await translateText("Away Team")}
            </text>
          </svg>`),
          top: 0,
          left: 0
        }
      ])
      .toFile(outputImagePath);

    console.log('Image created successfully!');
  } catch (error) {
    console.error('Error creating image:', error);
  }
}

const retrieveTeamLogo = async (teamId) => {
  const team = await fotmob.getTeam(teamId);
  return team.details?.sportsTeamJSONLD?.logo;
}

const translateText = async (text) => {
  if (language === "english") {
    // capitalize first letter
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return await translate(text, language);
}
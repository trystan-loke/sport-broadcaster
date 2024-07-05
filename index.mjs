import TextToSVG from 'text-to-svg';
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

let isTest = false;
let skipRandomCheck = false;
// Lambda function code
export const handler = async (event) => {
  console.log('Event: ', event);
  const { leagueId, recipients, matchDate } = event; 
  isTest = event.isTest || false;
  skipRandomCheck = event.skipRandomCheck || false;


  const matches = await fotmob.getMatchesByDate(matchDate || nowStr());
  const mappedMatches = mapMatches(matches, leagueId);

  try {
    const iterations = isTest ? 1 : 6; // Number of times to log messages
    const intervalInSeconds = isTest ? 1 : 10; // Interval in seconds between each log
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
              await sendMessage(match.id, match.statusId, match.home, match.away, recipients);
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
  if(!isTest)
    await dynamoDb.update(updateParams).promise();
}

const sendMessage = async (matchId, statusId, homeTeam, awayTeam, recipients) => {
  const apiId = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;
  const stringSession = new StringSession(process.env.STRING_SESSION);
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  
  try {
    if (!client.connected) {
      console.log('Connecting to telegram');
      await client.connect();
    }
    homeTeam.logo = await retrieveTeamLogo(homeTeam.id);
    awayTeam.logo = await retrieveTeamLogo(awayTeam.id);

    for (const recipient of recipients) {
      await generateResultImage('./assets/score-background.jpeg', isTest ? './output.jpg' : '/tmp/output.jpg', homeTeam.name, awayTeam.name, homeTeam.score, awayTeam.score, statusId === 6 ? '90:00' : '120:00', homeTeam.logo, awayTeam.logo, recipient.language);

      const result = await client.invoke(
        new Api.messages.SendMedia({
          peer: recipient.chatId,
          media: new Api.InputMediaUploadedPhoto({
            file: await client.uploadFile({
              file: new CustomFile(
                "output.jpg",
                fs.statSync(isTest ? "./output.jpg" : "/tmp/output.jpg").size,
                isTest ? "./output.jpg" : "/tmp/output.jpg"
              ),
              workers: 1,
            }),
          }),
          message: "",
          randomId: isTest || skipRandomCheck ? Math.floor(Math.random() * 1000000): matchId, // To prevent resending the same message
          // randomId: matchId, // Testing code
        })
      );
    }
    
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
  language
) {
  try {
    // Resize and overlay country flag image
    const homeLogoBuffer = await fetch(homeLogoUrl)
      .then(res => res.buffer())
      .then(buffer => sharp(buffer).resize({ width: 300 }).toBuffer());
    const awayLogoBuffer = await fetch(awayLogoUrl)
      .then(res => res.buffer())
      .then(buffer => sharp(buffer).resize({ width: 300 }).toBuffer());


    const textFontPath = './fonts/font-text.ttf'
    const numberFontPath = './fonts/DIGITALDREAMNARROW.ttf'
    const homeTeamSvgBuffer = generatedTextBuffer(await translateText(homeTeamName, language), 48, textFontPath, 'white');
    const awayTeamSvgBuffer = generatedTextBuffer(await translateText(awayTeamName, language), 48, textFontPath, 'white');
    const homeTextSvgBuffer = generatedTextBuffer(language === "english" ? "Home" : "主场", 30, textFontPath, '#7AE04E');
    const awayTextSvgBuffer = generatedTextBuffer(language === "english" ? "Away" : "客场", 30, textFontPath, '#7AE04E');
    const timeTextSvgBuffer = generatedTextBuffer(await translateText("Time", language), 30, textFontPath, '#7AE04E');
    const homeScoreSvgBuffer = generatedTextBuffer(homeScore.toString().padStart(2, '0'), 150, numberFontPath, 'white');
    const awayScoreSvgBuffer = generatedTextBuffer(awayScore.toString().padStart(2, '0'), 150, numberFontPath, 'white');
    const fullTimeSvgBuffer = generatedTextBuffer(fullTime, 50, numberFontPath, '#C62825');

    const backgroundMetadata = await sharp(backgroundImagePath, { limitInputPixels: false }).metadata();
    const homeTeamMetadata = await sharp(homeTeamSvgBuffer).metadata();
    const awayTeamMetadata = await sharp(awayTeamSvgBuffer).metadata();
    const homeTextMetadata = await sharp(homeTextSvgBuffer).metadata();
    const awayTextMetadata = await sharp(awayTextSvgBuffer).metadata();
    const homeTeamLeft = parseInt((backgroundMetadata.width - homeTeamMetadata.width) / 2) - 235;
    const awayTeamLeft = parseInt((backgroundMetadata.width - awayTeamMetadata.width) / 2) + 200;
    const homeTextLeft = parseInt((backgroundMetadata.width - homeTextMetadata.width) / 2) - 235;
    const awayTextLeft = parseInt((backgroundMetadata.width - awayTextMetadata.width) / 2) + 198;

    const fullTimeMetadata = await sharp(fullTimeSvgBuffer).metadata();
    const fullTimeLeft = parseInt((backgroundMetadata.width - fullTimeMetadata.width) / 2) - 19;

    await sharp(backgroundImagePath)
      .composite([
        { input: homeLogoBuffer, top: 240, left: 50 },
        { input: awayLogoBuffer, top: 240, left: 1210 },
        { input: homeTeamSvgBuffer, top: 100, left: homeTeamLeft },
        { input: awayTeamSvgBuffer, top: 100, left: awayTeamLeft },
        { input: homeTextSvgBuffer, top: 493, left: homeTextLeft },
        { input: awayTextSvgBuffer, top: 493, left: awayTextLeft },
        { input: timeTextSvgBuffer, top: 430, left: language === 'english' ? 745 : 750 },
        { input: homeScoreSvgBuffer, top: 250, left: 480 },
        { input: awayScoreSvgBuffer, top: 250, left: 902 },
        { input: fullTimeSvgBuffer, top: 491, left: fullTimeLeft },
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

const translateText = async (text, language) => {
  if (language === "english") {
    // capitalize first letter
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return await translate(text, language);
}

const generatedTextBuffer = (text, size, fontPath, fillColor) => {
  const textToSVG = TextToSVG.loadSync(fontPath);
  const svgOptions = {
    x: 0,
    y: 0,
    fontSize: size,
    anchor: 'top',
    attributes: { fill: fillColor },
  };

  const svg = textToSVG.getSVG(text, svgOptions);
  const svgBuffer = Buffer.from(svg);
  return svgBuffer;
}

// Simulate Lambda environment
// const event = { 
//   leagueId: 50, 
//   recipients: [
//     { chatId: "-4281667405", language: "chinese" },
//     { chatId: "-4281667405", language: "english" }
//   ],
//   matchDate: "20240702",
//   isTest: true,
//   skipRandomCheck: true
// };
// handler(event)
//     .then((result) => console.log(result))
//     .catch((error) => console.error(error));
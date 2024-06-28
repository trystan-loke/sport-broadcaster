// Lambda function code
export const handler = async (event) => {
  return "Logging completed.";
};

// Simulate Lambda environment
const event = {}; // You can pass any event data here if required by your Lambda function
handler(event)
    .then((result) => console.log(result))
    .catch((error) => console.error(error));



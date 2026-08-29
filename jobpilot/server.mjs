import http from "node:http";
import worker from "./web/worker.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4174);

http.createServer(async (request, response) => {
  const result = await worker.fetch(new Request(`http://${host}:${port}${request.url}`));
  response.statusCode = result.status;
  for (const [key, value] of result.headers) response.setHeader(key, value);
  response.end(Buffer.from(await result.arrayBuffer()));
}).listen(port, host, () => {
  console.log(`JobPilot is running at http://${host}:${port}/`);
});


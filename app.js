const express = require("express");
const app = express();
const dotenv = require("dotenv").config();

const mongoose = require("mongoose");
const Schema = require("mongoose").Schema;
const TokenSchema = new Schema({}, { strict: false });
const Token = mongoose.model("Token", TokenSchema);

const clientId = process.env.CLIENTID;
const clientSecret = process.env.CLIENTSECRET;
const callbackURL = process.env.CALLBACKURL;
const MONGOURL = process.env.MONGOURL;
const PORT = process.env.PORT;

const TwitterAPI = require("twitter-api-v2").default;
const twitterClient = new TwitterAPI({
  clientId,
  clientSecret,
});

const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const { Configuration, OpenAIApi } = require("openai");
// const configuration = new Configuration({
//   organization: process.env.ORGANIZATIONID,
//   apiKey: process.env.OPENAI_API_KEY,
// });

const auth = async function (req, res, next) {
  try {
    const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
      callbackURL,
      { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
    );

    // store verifier
    await Token.updateOne(
      { codeVerifier: { $exists: true }, state: { $exists: true } },
      { codeVerifier, state },
      { upsert: true }
    );
    res.status(201).redirect(url);
  } catch (err) {
    res.status(500).send("Server Error. Please try again.");
  }
};
app.use("/auth", auth);

const callback = async function (req, res, next) {
  try {
    const { state, code } = req.query;
    const token = await Token.findOne({ state });

    if (!token) return res.status(400).send("Stored tokens does not match!");

    const {
      client: loggedClient,
      accessToken,
      refreshToken,
    } = await twitterClient.loginWithOAuth2({
      code,
      codeVerifier: token.codeVerifier,
      redirectUri: callbackURL,
    });

    await Token.updateOne(
      { accessToken: { $exists: true }, refreshToken: { $exists: true } },
      { accessToken, refreshToken },
      { upsert: true }
    );
    res.status(201).send("You provided the correct tokens");
  } catch (err) {
    res.status(400).send("Re-used token. Please re-authenticate.");
  }
};
app.use("/callback", callback);

const tweet = async function (req, res, next) {
  try {
    const token = await Token.findOne({ refreshToken: { $exists: true } });
    console.log(token);
    const {
      client: refreshedClient,
      accessToken,
      refreshToken: newRefreshToken,
    } = await twitterClient.refreshOAuth2Token(token.refreshToken);

    await Token.updateOne(
      { accessToken: { $exists: true }, refreshToken: { $exists: true } },
      { accessToken, refreshToken: newRefreshToken },
      { upsert: true }
    );

    // const { data } = await refreshedClient.v2.me();
    // res.status(200).send(data);
    const nextTweet = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: "tweet something cool for #techtwitter",
        },
      ],
      max_tokens: 64,
    });
    console.log(nextTweet.choices);
  } catch (err) {
    console.error(err);
    res.status(400).send("Re-used token. Please re-authenticate.");
  }
};
app.use("/tweet", tweet);

app.listen(PORT, () => {
  console.log(`Server running at PORT ${PORT}`);
  mongoose
    .connect(MONGOURL, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
      console.log(`DB Connected`);
    })
    .catch((err) => {
      console.error(err);
    });
});

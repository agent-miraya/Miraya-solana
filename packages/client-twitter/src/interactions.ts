import { SearchMode, Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateMessageResponse,
    generateShouldRespond,
    messageCompletionFooter,
    shouldRespondFooter,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    stringToUuid,
    elizaLogger,
    getEmbeddingZeroVector,
    generateObject,
} from "@ai16z/eliza";
import { ClientBase } from "./base";
import { buildConversationThread, campaignRoomId, generateSolanaWallet, handleAgentQuery, saveCampaignMemory, sendTweet, shillingTweets, startedCampaignRoomId, wait } from "./utils.ts";

export const twitterMessageHandlerTemplate =
    `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# Task: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:
Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

{{actions}}

# Token Response Guidelines:
- If user mentions a token ($SYMBOL), provide information about the token
- Include token price if available
- Add appropriate disclaimers
- Keep responses professional and compliance-focused

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). Include an action, if appropriate. {{actionNames}}:
{{currentPost}}
` + messageCompletionFooter;

export const requestFundTemplate =
    `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# Task: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:
Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

{{actions}}

# Token Response Guidelines:
- You have to request funds from the user.
- Include token name also.
- Add appropriate disclaimers
- Keep responses professional and compliance-focused

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). Include an action, if appropriate. {{actionNames}}:
{{currentPost}}
` + messageCompletionFooter;

export const twitterShouldRespondTemplate =
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP .

{{agentName}} should respond to messages that are directed at them, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.
If a message is not relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.
if a user ask {{agentName}} to shill a token should RESPOND.
If {{agentName}} must ONLY respond if a user ask to promote/shill a token/coin, {{agentName}} should RESPOND, In all other case {{agentName}} should IGNORE.

{{recentPosts}}

IMPORTANT: {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

{{currentPost}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

export const isTokenPromotionTemplate = `
# INSTRUCTIONS: Determine if the message is requesting to promote/shill a specific token/coin. Respond with "YES" or "NO".

Response options are YES, NO.

The message must meet ALL of the following criteria:
1. The message must be directed at {{agentName}}
2. The message may contain words like "shill", "promote", "coin", or "token"
3. The user must be explicitly  promote/shilling a specific token/coin
4. It must be a promotional request, not just a question or discussion about a token
5. If user, instead is asking for bot to shill their token, instead of shilling token themselves, then it is a promotional request. You have to respond with "NO".
6.

Examples:
- "Hey @{{twitterUserName}}, can you shill my new token $XYZ?" -> YES
- "Hey @{{twitterUserName}}, please promote our new coin" -> YES
- "@{{twitterUserName}} would you help us shill this token?" -> YES
- "@{{twitterUserName}} what do you think about Bitcoin?" -> NO (just asking opinion)
- "This token is going to moon!" -> NO (not directed at bot)
- "@{{twitterUserName}} do you know about any good tokens?" -> NO (general question)

Current message:
{{currentPost}}

Thread context:
{{formattedConversation}}

# INSTRUCTIONS: Respond with [YES] if this is a token promotion request, or [NO] if it is not.
`


const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "userAddress": "BieefG47jAHCGZBxi2q87RDuHyGZyYC3vAzxpyu8pump",
}
\`\`\`

{{currentPost}}

Given the recent messages, extract the following information about the requested token transfer:
- Recipient wallet address

If not address is provided, respond with null

Respond with a JSON markdown block containing only the extracted values.`;

// export const tweetToInfoTemplate = `
// # INSTRUCTIONS: Extract key promotional information from the conversation about token/coin shilling. Respond ONLY with a JSON object containing the following details if found:

// - Token symbol (tokens typically start with $ but distinguish from price amounts)
// - Campaign slogan or tagline
// - Bounty/reward amount
// - Campaign duration

// Do not make assumptions or add information that isn't explicitly stated in the conversation. If a field cannot be found, omit it from the response object.

// {{currentPost}}

// Thread of Tweets You Are Replying To:

// {{formattedConversation}}

// # INSTRUCTIONS: Respond only with a JSON object containing the found information in this format:
// {
//   "token": "string",     // The token symbol
//   "slogan": "string",    // Marketing slogan/tagline
//   "bounty": "string",    // Reward amount
//   "duration": "string"   // Campaign timeframe
// }

// If no promotional information is found, respond with an empty object {}.
// `

const tweetToInfoTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
  "name": "Test Token",
  "token": "$USDC",     // The token symbol
  "slogan": "best memecoin in solana",    // Marketing slogan/tagline
  "bounty": "10SOL",    // Reward amount
  "duration": "1024"   // Campaign timeframe(in seconds), convert automatically from any given time window.
}
\`\`\`

Do not make assumptions or add information that isn't explicitly stated in the conversation. If a field cannot be found, omit it from the response object.

{{currentPost}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

Given the recent messages, extract or generate (come up with if not included) the following information about the requested token creation:
- Token name
- Token symbol
- Token/campaign description  or slogan
- Amount of tokens for bounty. Usually in crypto, like 100SOL, or 1000USDC

Respond with a JSON markdown block containing only the extracted values.`;

export class TwitterInteractionClient {
    client: ClientBase;
    runtime: IAgentRuntime;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
    }

    async start() {
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            setTimeout(
                handleTwitterInteractionsLoop,
                Number(
                    this.runtime.getSetting("TWITTER_POLL_INTERVAL") || 120
                ) * 1000 // Default to 2 minutes
            );
        };
        handleTwitterInteractionsLoop();
    }

    async handleTwitterInteractions() {
        elizaLogger.log("Checking Twitter interactions");

        const twitterUsername = this.client.profile.username;
        try {
            // Check for mentions
            const tweetCandidates = (
                await this.client.fetchSearchTweets(
                    `@${twitterUsername}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            // de-duplicate tweetCandidates with a set
            const uniqueTweetCandidates = [...new Set(tweetCandidates)];
            // Sort tweet candidates by ID in ascending order
            uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.client.profile.id);

            // for each tweet candidate, handle the tweet
            for (const tweet of uniqueTweetCandidates) {
                if (
                    !this.client.lastCheckedTweetId ||
                    BigInt(tweet.id) > this.client.lastCheckedTweetId
                ) {
                    // Generate the tweetId UUID the same way it's done in handleTweet
                    const tweetId = stringToUuid(
                        tweet.id + "-" + this.runtime.agentId
                    );

                    // Check if we've already processed this tweet
                    const existingResponse =
                        await this.runtime.messageManager.getMemoryById(
                            tweetId
                        );

                    if (existingResponse) {
                        elizaLogger.log(
                            `Already responded to tweet ${tweet.id}, skipping`
                        );
                        continue;
                    }
                    elizaLogger.log("New Tweet found", tweet.permanentUrl);

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const userIdUUID =
                        tweet.userId === this.client.profile.id
                            ? this.runtime.agentId
                            : stringToUuid(tweet.userId!);

                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );

                    const thread = await buildConversationThread(
                        tweet,
                        this.client
                    );

                    const message = {
                        content: { text: tweet.text },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId,
                    };

                    await this.handleTweet({
                        tweet,
                        message,
                        thread,
                    });

                    // Update the last checked tweet ID after processing each tweet
                    this.client.lastCheckedTweetId = BigInt(tweet.id);
                }
            }

            // Save the latest checked tweet ID to the file
            await this.client.cacheLatestCheckedTweetId();

            elizaLogger.log("Finished checking Twitter interactions");
        } catch (error) {
            elizaLogger.error("Error handling Twitter interactions:", error, error.message);
        }
    }

    private async handleTweet({
        tweet,
        message,
        thread,
    }: {
        tweet: Tweet;
        message: Memory;
        thread: Tweet[];
    }) {
        if (tweet.userId === this.client.profile.id) {
            // console.log("skipping tweet from bot itself", tweet.id);
            // Skip processing if the tweet is from the bot itself
            return;
        }

        if (!message.content.text) {
            elizaLogger.log("Skipping Tweet with no text", tweet.id);
            return { text: "", action: "IGNORE" };
        }

        elizaLogger.log("Processing Tweet: ", tweet.id);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        elizaLogger.debug("Thread: ", thread);
        const formattedConversation = thread
            .map(
                (tweet) => `@${tweet.username} (${new Date(
                    tweet.timestamp * 1000
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
        ${tweet.text}`
            )
            .join("\n\n");

        elizaLogger.debug("formattedConversation: ", formattedConversation);

        let state = await this.runtime.composeState(message, {
            twitterClient: this.client.twitterClient,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            formattedConversation,
        });

        // check if the tweet exists, save if it doesn't
        const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        elizaLogger.log("This is latest code v1.0")

        if (!tweetExists) {
            elizaLogger.log("tweet does not exist, saving");
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                              tweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.client.saveRequestMessage(message, state);
        }

        const startedCampaigns = await this.runtime.messageManager.getMemories({
            roomId: startedCampaignRoomId,
            count: 100,
            unique: false,
        });

        const notstartedCampaigns = await this.runtime.messageManager.getMemories({
            roomId: campaignRoomId,
            count: 100,
            unique: false,
        })

        const isAgentQuery = [...startedCampaigns, ...notstartedCampaigns].find(memory => {
            if (memory.content.conversationId && tweet.conversationId === memory.content.conversationId){
                return memory
            }

            return false
        })

        if (isAgentQuery){
            if (tweet.username !== isAgentQuery.content.username){
                elizaLogger.log("Invalid user for wallet prompt.");
                return;
            }
            elizaLogger.log("This is a prompt tweet.");
            const promptMessage = tweet.text;

            const promptAnswer = await handleAgentQuery(isAgentQuery, promptMessage, this.client);

            const response: Content = {
                text: promptAnswer
            }


            const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

            response.inReplyTo = stringId;

            const removeQuotes = (str: string) =>
                str.replace(/^['"](.*)['"]$/, "$1");

            response.text = removeQuotes(response.text);

            await sendTweet(
                this.client,
                response,
                stringToUuid(tweet.conversationId),
                this.runtime.getSetting("TWITTER_USERNAME"),
                tweet.id
            );

            return;
        }



        const isShillingForCampaign = startedCampaigns.find(memory => {
            if (memory.content.token && tweet.text.includes(memory.content.token as string)){
                return memory
            }

            return false
        })

        if (isShillingForCampaign){
            elizaLogger.log("This is a shilling tweet. saving in memort");

            const memoryId = stringToUuid(tweet.id + "-" + isShillingForCampaign.id);

            const userIdUUID = stringToUuid(tweet.userId as string);

            const shillingRoomId = stringToUuid("shilling-tweets-room" + "-" + isShillingForCampaign.id);

            const transferContext = composeContext({
                state,
                template: transferTemplate,
            });

            const content = await generateObject({
                runtime: this.runtime,
                context: transferContext,
                modelClass: ModelClass.LARGE,
            });

            if (!content.userAddress){
                elizaLogger.log("No user address found in tweet")
                return;
            }

            const message = {
                id: memoryId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    tweet: tweet,
                    userAddress: content.userAddress,
                    campaign: isShillingForCampaign.id as string,
                },
                userId: userIdUUID,
                roomId: shillingRoomId,
                createdAt: tweet.timestamp * 1000,
                embedding: getEmbeddingZeroVector(),
            };


            await this.runtime.messageManager.createMemory(message);

            // const hash = await distributeFunds(message, isShillingForCampaign, this.runtime.getSetting("LIT_EVM_PRIVATE_KEY"));

            // // const hash = "5DX7bpncr7XKRKsoJ7UL8xq7R8E3KLrWJeXyz4GMUEnhjrhmKysQD8NXwmobKsMPvduBKvpZJLWgjHeV6nfDXNd4"
            // const link = `https://solscan.io/tx/${hash}`

            // const response: Content = {
            //     text: `Thanks for participating in campaign. Bounty deposited on your sol address.\n\nTransaction hash: ${link}.`
            // }

            // const removeQuotes = (str: string) =>
            //     str.replace(/^['"](.*)['"]$/, "$1");

            // const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

            // response.inReplyTo = stringId;

            // response.text = removeQuotes(response.text);

            // const tweetmemory = await sendTweet(
            //     this.client,
            //     response,
            //     stringToUuid(tweet.conversationId),
            //     this.runtime.getSetting("TWITTER_USERNAME"),
            //     tweet.id
            // );

            return;
        }

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterShouldRespondTemplate ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                twitterShouldRespondTemplate,
        });

        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.MEDIUM,
        });

        // Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
        elizaLogger.log("shouldrespond", shouldRespond)
        console.log("shouldrespond", shouldRespond)
        if (shouldRespond !== "RESPOND") {
            elizaLogger.log("Not responding to message");
            return { text: "Response Decision:", action: shouldRespond };
        }

        const tweetToInfoContext = composeContext({
            state,
            template: tweetToInfoTemplate
        });

        const campaignDetails = await generateObject({
            runtime: this.runtime,
            context: tweetToInfoContext,
            modelClass: ModelClass.MEDIUM,
        });

        const litWalletResult = await generateSolanaWallet(this.runtime.getSetting("LIT_EVM_PRIVATE_KEY"),)

        campaignDetails.publicKey = litWalletResult.wkInfo.generatedPublicKey;
        campaignDetails.litWalletResult = litWalletResult;

        campaignDetails.username = tweet.username;
        campaignDetails.conversationId = tweet.conversationId;

        const roomId = stringToUuid(
            tweet.conversationId + "-" + this.client.runtime.agentId
        );

        elizaLogger.log("Campaign Details:", campaignDetails);

        const context = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                this.runtime.character?.templates?.messageHandlerTemplate ||
                twitterMessageHandlerTemplate,


        });

        elizaLogger.debug("Interactions prompt:\n" + context);

        const response: Content = {
            text: `To start your campaign, please send ${campaignDetails?.bounty} to:\n\n${campaignDetails?.publicKey}\n\nCampaign will activate automatically after funds are received. ⏳\n\n🔒 Verify address carefully before sending.`
        }

        await saveCampaignMemory(this.client, campaignDetails, roomId)

        // const response = await generateMessageResponse({
        //     runtime: this.runtime,
        //     context,
        //     modelClass: ModelClass.MEDIUM,
        // });

        const removeQuotes = (str: string) =>
            str.replace(/^['"](.*)['"]$/, "$1");

        const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

        response.inReplyTo = stringId;

        response.text = removeQuotes(response.text);

        if (response.text) {
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this.client,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        tweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(response);

                state = (await this.runtime.updateRecentMessageState(
                    state
                )) as State;

                for (const responseMessage of responseMessages) {
                    if (
                        responseMessage ===
                        responseMessages[responseMessages.length - 1]
                    ) {
                        responseMessage.content.action = response.action;
                    } else {
                        responseMessage.content.action = "CONTINUE";
                    }
                    await this.runtime.messageManager.createMemory(
                        responseMessage
                    );
                }

                await this.runtime.evaluate(message, state);

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state
                );

                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

                await this.runtime.cacheManager.set(
                    `twitter/tweet_generation_${tweet.id}.txt`,
                    responseInfo
                );
                await wait();
            } catch (error) {
                elizaLogger.error(`Error sending response tweet: ${error}`);
            }
        }
    }

    async buildConversationThread(
        tweet: Tweet,
        maxReplies: number = 10
    ): Promise<Tweet[]> {
        const thread: Tweet[] = [];
        const visited: Set<string> = new Set();

        async function processThread(currentTweet: Tweet, depth: number = 0) {
            elizaLogger.log("Processing tweet:", {
                id: currentTweet.id,
                inReplyToStatusId: currentTweet.inReplyToStatusId,
                depth: depth,
            });

            if (!currentTweet) {
                elizaLogger.log("No current tweet found for thread building");
                return;
            }

            if (depth >= maxReplies) {
                elizaLogger.log("Reached maximum reply depth", depth);
                return;
            }

            // Handle memory storage
            const memory = await this.runtime.messageManager.getMemoryById(
                stringToUuid(currentTweet.id + "-" + this.runtime.agentId)
            );
            if (!memory) {
                const roomId = stringToUuid(
                    currentTweet.conversationId + "-" + this.runtime.agentId
                );
                const userId = stringToUuid(currentTweet.userId);

                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    currentTweet.username,
                    currentTweet.name,
                    "twitter"
                );

                this.runtime.messageManager.createMemory({
                    id: stringToUuid(
                        currentTweet.id + "-" + this.runtime.agentId
                    ),
                    agentId: this.runtime.agentId,
                    content: {
                        text: currentTweet.text,
                        source: "twitter",
                        url: currentTweet.permanentUrl,
                        inReplyTo: currentTweet.inReplyToStatusId
                            ? stringToUuid(
                                  currentTweet.inReplyToStatusId +
                                      "-" +
                                      this.runtime.agentId
                              )
                            : undefined,
                    },
                    createdAt: currentTweet.timestamp * 1000,
                    roomId,
                    userId:
                        currentTweet.userId === this.twitterUserId
                            ? this.runtime.agentId
                            : stringToUuid(currentTweet.userId),
                    embedding: getEmbeddingZeroVector(),
                });
            }

            if (visited.has(currentTweet.id)) {
                elizaLogger.log("Already visited tweet:", currentTweet.id);
                return;
            }

            visited.add(currentTweet.id);
            thread.unshift(currentTweet);

            elizaLogger.debug("Current thread state:", {
                length: thread.length,
                currentDepth: depth,
                tweetId: currentTweet.id,
            });

            if (currentTweet.inReplyToStatusId) {
                elizaLogger.log(
                    "Fetching parent tweet:",
                    currentTweet.inReplyToStatusId
                );
                try {
                    const parentTweet = await this.twitterClient.getTweet(
                        currentTweet.inReplyToStatusId
                    );

                    if (parentTweet) {
                        elizaLogger.log("Found parent tweet:", {
                            id: parentTweet.id,
                            text: parentTweet.text?.slice(0, 50),
                        });
                        await processThread(parentTweet, depth + 1);
                    } else {
                        elizaLogger.log(
                            "No parent tweet found for:",
                            currentTweet.inReplyToStatusId
                        );
                    }
                } catch (error) {
                    elizaLogger.log("Error fetching parent tweet:", {
                        tweetId: currentTweet.inReplyToStatusId,
                        error,
                    });
                }
            } else {
                elizaLogger.log(
                    "Reached end of reply chain at:",
                    currentTweet.id
                );
            }
        }

        // Need to bind this context for the inner function
        await processThread.bind(this)(tweet, 0);

        elizaLogger.debug("Final thread built:", {
            totalTweets: thread.length,
            tweetIds: thread.map((t) => ({
                id: t.id,
                text: t.text?.slice(0, 50),
            })),
        });

        return thread;
    }
}

// Mini App portions adapted from better-auth-telegram 2.0.1.
// Copyright (c) 2026 Vibe Code, MIT. See LICENSE and README.md.
import {APIError,createAuthEndpoint} from 'better-auth/api';
import {defineErrorCodes} from '@better-auth/core/utils/error-codes';
import {setSessionCookie} from 'better-auth/cookies';

const PLUGIN_ID='telegram';
const ERROR_CODES=defineErrorCodes({
 BOT_TOKEN_REQUIRED:'Telegram plugin: botToken is required',
 INIT_DATA_REQUIRED:'initData is required and must be a string',
 INVALID_MINI_APP_INIT_DATA:'Invalid Mini App initData',
 INVALID_MINI_APP_DATA_STRUCTURE:'Invalid Mini App data structure',
 NO_USER_IN_INIT_DATA:'No user data in initData',
 MINI_APP_AUTO_SIGNIN_DISABLED:'User not found and auto-signin is disabled for Mini Apps',
});

var encoder = new TextEncoder();
async function hmacSha256(key, data) {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(data)
  );
}
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function parseMiniAppInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [key, value] of params.entries()) {
    if (key === "user" || key === "receiver" || key === "chat") {
      try {
        data[key] = JSON.parse(value);
      } catch {
      }
    } else if (key === "auth_date" || key === "can_send_after") {
      data[key] = Number(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}
async function verifyMiniAppInitData(initData, botToken, maxAge = 300) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return false;
  }
  params.delete("hash");
  const authDate = params.get("auth_date");
  if (!authDate) {
    return false;
  }
  const authDateNum = Number(authDate);
  const currentTime = Math.floor(Date.now() / 1e3);
  if (currentTime - authDateNum > maxAge) {
    return false;
  }
  const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = new Uint8Array(
    await hmacSha256(encoder.encode("WebAppData"), botToken)
  );
  const calculatedHash = bufferToHex(
    await hmacSha256(secretKey, dataCheckString)
  );
  return calculatedHash === hash;
}
function validateMiniAppData(data) {
  return typeof data === "object" && data !== null && typeof data.auth_date === "number" && typeof data.hash === "string" && (data.user === void 0 || typeof data.user === "object" && typeof data.user.id === "number" && typeof data.user.first_name === "string");
}

function createMiniAppEndpoints(config) {
  return {
    signInWithMiniApp: createAuthEndpoint(
      "/telegram/miniapp/signin",
      {
        method: "POST"
      },
      async (ctx) => {
        const body = await ctx.body;
        const { initData } = body;
        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }
        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        if (config.miniAppValidateInitData && !await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
        )) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_MINI_APP_INIT_DATA
          );
        }
        const data = parseMiniAppInitData(initData);
        if (!validateMiniAppData(data)) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE
          );
        }
        if (!data.user) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
        }
        const miniAppUser = data.user;
        const defaultUserData = {
          name: miniAppUser.last_name ? `${miniAppUser.first_name} ${miniAppUser.last_name}` : miniAppUser.first_name,
          image: miniAppUser.photo_url,
          email: void 0
          // Telegram doesn't provide email
        };
        const userData = config.mapMiniAppDataToUser ? config.mapMiniAppDataToUser(miniAppUser) : defaultUserData;
        const existingAccount = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "providerId",
              value: PLUGIN_ID
            },
            {
              field: "accountId",
              value: miniAppUser.id.toString()
            }
          ]
        });
        let userId;
        if (existingAccount) {
          userId = existingAccount.userId;
        } else {
          const existingUser = await ctx.context.adapter.findOne({
            model: "user",
            where: [
              {
                field: "telegramId",
                value: miniAppUser.id.toString()
              }
            ]
          });
          if (existingUser) {
            userId = existingUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                userId,
                providerId: PLUGIN_ID,
                accountId: miniAppUser.id.toString(),
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
          } else if (config.autoCreateUser && config.miniAppAllowAutoSignin) {
            const newUser = await ctx.context.adapter.create({
              model: "user",
              data: {
                ...userData,
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
            userId = newUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                userId: newUser.id,
                providerId: PLUGIN_ID,
                accountId: miniAppUser.id.toString(),
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
          } else {
            throw APIError.from(
              "NOT_FOUND",
              ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED
            );
          }
        }
        const session = await ctx.context.internalAdapter.createSession(userId);
        const user = await ctx.context.adapter.findOne({
          model: "user",
          where: [{ field: "id", value: userId }]
        });
        await setSessionCookie(ctx, {
          session,
          user
        });
        return ctx.json({
          session,
          user
        });
      }
    ),
    validateMiniApp: createAuthEndpoint(
      "/telegram/miniapp/validate",
      {
        method: "POST"
      },
      async (ctx) => {
        const body = await ctx.body;
        const { initData } = body;
        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }
        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        const isValid = await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
        );
        if (!isValid) {
          return ctx.json({
            valid: false,
            data: null
          });
        }
        const data = parseMiniAppInitData(initData);
        return ctx.json({
          valid: true,
          data
        });
      }
    )
  };
}
function getMiniAppRateLimits() {
  return [
    {
      pathMatcher: (path) => path === "/telegram/miniapp/signin",
      window: 60,
      max: 10
    },
    {
      pathMatcher: (path) => path === "/telegram/miniapp/validate",
      window: 60,
      max: 20
    }
  ];
}

function createPluginConfig(options) {
 if(options.loginWidget!==false||options.oidc?.enabled||options.miniApp?.validateInitData===false)
  throw new Error('Lowwin Telegram compatibility package requires signed Mini App authentication; widget, OIDC and validation bypass are unsupported.');
 const maxAuthAge=options.maxAuthAge??300;
 if(!Number.isSafeInteger(maxAuthAge)||maxAuthAge<=0||maxAuthAge>300)throw new Error('Mini App authentication age must be between 1 and 300 seconds.');
 return {
  botToken:options.botToken??'',botUsername:options.botUsername??'',
  widgetEnabled:false,oidcEnabled:false,testMode:options.testMode??false,
  autoCreateUser:options.autoCreateUser??true,maxAuthAge,
  miniAppEnabled:options.miniApp?.enabled??false,miniAppValidateInitData:true,
  miniAppAllowAutoSignin:options.miniApp?.allowAutoSignin??true,
  mapMiniAppDataToUser:options.miniApp?.mapMiniAppDataToUser,
 };
}

function createTelegramSchema(config) {
  if (!(config.widgetEnabled || config.miniAppEnabled)) {
    return void 0;
  }
  return {
    user: {
      fields: {
        telegramId: {
          type: "string",
          required: false,
          unique: false,
          input: false
        },
        telegramPhoneNumber: {
          type: "string",
          required: false,
          unique: false,
          input: false
        },
        telegramUsername: {
          type: "string",
          required: false,
          unique: false,
          input: false
        }
      }
    },
    account: {
      fields: {
        telegramId: {
          type: "string",
          required: false,
          unique: false
        },
        telegramUsername: {
          type: "string",
          required: false,
          unique: false
        }
      }
    }
  };
}

function createConfigEndpoint(config) {
  return {
    getTelegramConfig: createAuthEndpoint(
      "/telegram/config",
      {
        method: "GET"
      },
      async (ctx) => ctx.json({
        botUsername: config.botUsername,
        loginWidgetEnabled: config.widgetEnabled,
        miniAppEnabled: config.miniAppEnabled,
        oidcEnabled: config.oidcEnabled,
        testMode: config.testMode
      })
    )
  };
}

// The Better Auth 1.7.14 public endpoint/adapter/cookie APIs retain the
// Mini App contract. Unsupported login-widget/OIDC code is not shipped.
export function telegram(options) {
 const config=createPluginConfig(options);
 return {id:PLUGIN_ID,schema:createTelegramSchema(config),
  endpoints:{...(config.miniAppEnabled?createMiniAppEndpoints(config):{}),...createConfigEndpoint(config)},
  $ERROR_CODES:ERROR_CODES,rateLimit:config.miniAppEnabled?getMiniAppRateLimits():[],
 };
}

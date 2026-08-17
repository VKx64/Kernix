<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    // Where the hosted MCP server answers. The setup screen prints this so a
    // person can copy a working endpoint instead of guessing the hostname.
    'mcp' => [
        'url' => env('MCP_PUBLIC_URL'),
    ],

    // The WhatsApp bridge container. It holds the linked account and the socket;
    // Kernix only ever talks to it over this address, with this shared secret,
    // and the same secret is what the bridge presents on the inbound callback.
    'whatsapp' => [
        'url' => env('WHATSAPP_BRIDGE_URL'),
        'token' => env('WHATSAPP_BRIDGE_TOKEN'),
        'timeout' => (int) env('WHATSAPP_BRIDGE_TIMEOUT', 15),
        // What the assistant answers to in a group chat. It stays silent in a
        // group until it is addressed by this word.
        'trigger' => env('WHATSAPP_TRIGGER', 'kernix'),
        // Fills in a locally-written number: `09171234567` is `639171234567`.
        'country_code' => env('WHATSAPP_COUNTRY_CODE', '63'),
        // The account tasks raised from a chat are authored by. Blank means the
        // project's manager, which is usually what a studio wants.
        'actor_user_id' => env('WHATSAPP_ACTOR_USER_ID'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];

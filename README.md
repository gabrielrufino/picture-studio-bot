# Picture Studio Bot

A Telegram bot for processing and manipulating images.

## Features

- 🗜️ **Compress** - Reduce image file size
- 🔄 **Convert** - Convert between formats (JPEG, PNG, WebP)
- ✂️ **Crop** - Crop images to custom dimensions
- 📐 **Resize** - Resize images to preset dimensions
- 🔄 **Rotate** - Rotate images by 90°, 180°, or -90°
- 🔗 **Download** - Download an image from a URL
- 💧 **Watermark** - Apply a watermark to batches of photos, choosing corners and size

## Getting started

1. Clone the repository
2. Install dependencies
    ```bash
    pnpm install
    ```
3. Set up environment variables
    ```bash
    cp .env.example .env
    ```
    Optionally set `ALLOWED_TELEGRAM_IDS` to a comma-separated list of Telegram user IDs. When set, the bot ignores every other user (no reply). Leave it empty to allow everyone.
4. Start the bot
    ```bash
    pnpm start:dev
    ```

## Commands

- `/start` - Start using the bot
- `/help` - Show available commands
- `/compress` - Compress an image
- `/convert` - Convert an image format
- `/crop` - Crop an image
- `/info` - Get image info
- `/resize` - Resize an image
- `/rotate` - Rotate an image
- `/download` - Download an image from a URL
- `/watermark` - Apply a watermark to up to 3 photos (Free) or 100 photos (Pro) per operation
- `/pro` - Upgrade to Pro
- `/language` - Change language
- `/feedback` - Send feedback

## Limits

| Rule | Free | Pro |
|---|---:|---:|
| Photos per operation | 3 | 100 |
| Operations per day | 3 | 50 |
| File size per photo | 10 MB | 50 MB |
| Watermark file size | 10 MB | 50 MB |
| Pro plan duration | — | 30 days |

The bot processes up to 150 updates per 10 seconds per user.

Compress, crop, resize, and rotate results are sent as photos. Conversion, watermark, and download results are sent as documents to preserve format and transparency. Watermark batches are sent in albums of up to 10 files.

Downloads (`/download`) use the same per-file size limits as the other commands.

## License

UNLICENSED

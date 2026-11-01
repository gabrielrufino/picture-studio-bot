# Picture Studio Bot

A Telegram bot for processing and manipulating images.

## Features

- 🗜️ **Compress** - Reduce image file size
- 🔄 **Convert** - Convert between formats (JPEG, PNG, WebP)
- ✂️ **Crop** - Crop images to custom dimensions
- 📐 **Resize** - Resize images to preset dimensions
- 🔄 **Rotate** - Rotate images by 90°, 180°, or -90°
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

A watermark batch counts as a single operation. Results are always sent as documents so the original format and transparency are preserved, in albums of up to 10 files.

## License

UNLICENSED

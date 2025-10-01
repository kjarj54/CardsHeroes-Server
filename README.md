# 🚀 CardsHeroes Server

<div align="center">
  <img src="https://raw.githubusercontent.com/colyseus/colyseus/master/media/header.png" alt="Colyseus" width="400"/>
  
  **Real-time multiplayer server for CardsHeroes card battle game**
  
  [![Colyseus](https://img.shields.io/badge/Colyseus-0.15.x-green.svg)](https://colyseus.io/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen.svg)](https://nodejs.org/)
  [![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
</div>

## 🎯 Overview

The CardsHeroes Server is a robust, real-time multiplayer backend built with [Colyseus](https://colyseus.io/) that powers the strategic card battle game CardsHeroes. It handles room management, game state synchronization, player matchmaking, and real-time communication between players.

## ✨ Features

### 🎮 Game Server Capabilities
- **Real-time Multiplayer**: Seamless synchronization between players
- **Room Management**: Automatic room creation and player matchmaking
- **Game State Management**: Centralized game logic and state validation
- **Anti-cheat Protection**: Server-side validation of all game moves
- **Scalable Architecture**: Handle multiple concurrent games

### 🃏 Game Logic Implementation
- **Card Distribution**: Fair random distribution of 68 unique cards
- **Betting System**: Secure credit management and betting validation
- **Turn Management**: Precise turn-based gameplay coordination
- **Special Cards**: Joker randomization and Dr. Manhattan abilities
- **Score Calculation**: Server-side score validation and proximity to 34

## 🛠️ Technology Stack

- **Framework**: [Colyseus](https://colyseus.io/) - Multiplayer game server framework
- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Real-time**: WebSocket connections
- **Testing**: Mocha test suite + Colyseus loadtest tools
- **Deployment**: Compatible with major cloud platforms

## 📁 Project Structure

```
📁 CardsHeroes-Server/
├── 🚀 src/
│   ├── 🏠 rooms/
│   │   ├── MyRoom.ts           # Main game room logic
│   │   └── 📊 schema/
│   │       └── MyRoomState.ts  # Game state schema
│   ├── ⚙️ app.config.ts        # Server configuration
│   └── 🎯 index.ts             # Entry point
├── 🧪 test/
│   └── MyRoom_test.ts          # Room testing suite
├── ⚡ loadtest/
│   └── example.ts              # Load testing scripts
├── 📦 package.json             # Dependencies and scripts
├── 🔧 tsconfig.json            # TypeScript configuration
├── 🌐 render.yaml              # Render deployment config
└── 🔄 ecosystem.config.cjs     # PM2 process management
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18 or higher
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kjarj54/CardsHeroes-Server.git
   cd CardsHeroes-Server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm start
   ```

4. **Access the monitor** (optional)
   ```
   http://localhost:2567/colyseus
   ```

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the development server with hot reload |
| `npm test` | Run the test suite |
| `npm run loadtest` | Run load testing with multiple clients |
| `npm run build` | Build the project for production |
| `npm run dev` | Start in development mode |

## 🎮 Game Server Features

### Room Management
- **Automatic Matchmaking**: Players are matched automatically
- **Room States**: Waiting, Playing, Finished
- **Player Reconnection**: Handle disconnections gracefully
- **Spectator Mode**: Watch ongoing games

### Game Flow Control
```typescript
// Example game phases handled by server
enum GamePhase {
  WAITING_FOR_PLAYERS,
  BETTING_PHASE,
  CARD_SELECTION,
  BATTLE_RESOLUTION,
  ROUND_END,
  GAME_OVER
}
```

### Real-time Events
- Player joins/leaves
- Card selections
- Battle outcomes
- Score updates
- Credit changes
- Special card activations

## 🔧 Configuration

### Environment Variables
```env
PORT=2567                    # Server port
NODE_ENV=development         # Environment mode
COLYSEUS_MONITOR=true       # Enable monitoring dashboard
```

### Game Settings
- **Max Players per Room**: 2
- **Starting Credits**: 100
- **Cards per Player**: 10
- **Total Card Pool**: 68 unique cards
- **Target Score**: 34

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Load Testing
```bash
npm run loadtest
```

The load testing simulates multiple clients connecting and playing games simultaneously to ensure server stability.

## 🌐 Deployment

### Render.com (Recommended)
The project includes a `render.yaml` configuration for easy deployment:

```yaml
services:
  - type: web
    name: cardsheroes-server
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm start
```

### Other Platforms
- **Railway**: Compatible with Railway deployment
- **Heroku**: Heroku-ready with Procfile
- **DigitalOcean**: App Platform compatible
- **AWS**: Deploy using Elastic Beanstalk or ECS

## 📊 Monitoring

Access the Colyseus monitoring dashboard at `/colyseus` to view:
- Active rooms and players
- Server performance metrics
- Real-time connection status
- Game statistics

## 🔐 Security Features

- **Input Validation**: All client inputs are validated
- **Anti-cheat**: Server-side game logic prevents cheating
- **Rate Limiting**: Prevent spam and abuse
- **Secure WebSockets**: Encrypted connections

## 👥 Development Team

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/kjarj54">
        <img src="https://github.com/kjarj54.png" width="100px;" alt="kjarj54"/>
        <br />
        <sub><b>kjarj54</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/kevtico20">
        <img src="https://github.com/kevtico20.png" width="100px;" alt="kevtico20"/>
        <br />
        <sub><b>kevtico20</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Anthonyah131">
        <img src="https://github.com/Anthonyah131.png" width="100px;" alt="Anthonyah131"/>
        <br />
        <sub><b>Anthonyah131</b></sub>
      </a>
    </td>
  </tr>
</table>

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📚 Documentation

- [Colyseus Documentation](https://docs.colyseus.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Game Rules](https://github.com/kevtico20/CardsHeroes#game-rules-summary)

## 🐛 Troubleshooting

### Common Issues

**Port already in use**
```bash
# Kill process using port 2567
npx kill-port 2567
npm start
```

**WebSocket connection failed**
- Check firewall settings
- Ensure port 2567 is accessible
- Verify client connection URL

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Repositories

- 🎮 **Client**: [CardsHeroes](https://github.com/kevtico20/CardsHeroes) - Defold game client

---

<div align="center">
  <p>⚔️ Built with Colyseus for epic multiplayer battles! ⚔️</p>
  <p>🚀 Ready to host legendary card battles? Deploy now! 🚀</p>
</div>

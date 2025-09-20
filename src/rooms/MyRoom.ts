import { Room, Client } from "@colyseus/core";
import { MyRoomState, Player, GameState } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 2;
  
  onCreate(options: any) {
    this.setState(new MyRoomState());
    
    // Initialize game state
    this.state.game.phase = "waiting";
    this.state.game.targetScore = 34;
    this.state.game.betTimeLeft = 15;
    this.state.playerCount = 0;
    this.state.gameStatus = "waiting";
    
    // Set up message handlers
    this.setupMessageHandlers();
    
    console.log("Room created");
  }

  onJoin(client: Client, options: any) {
    console.log(`Client ${client.sessionId} joined`);
    
    // Create new player
    const player = new Player();
    player.sessionId = client.sessionId;
    player.playerId = this.state.players.size + 1; // Use actual count
    player.connected = true;
    player.ready = false;
    player.score = 0;
    player.credits = 100;
    player.bet = 0;
    player.betConfirmed = false;
    
    // Initialize hand and card states
    for (let i = 0; i < 10; i++) {
      player.hand.push(0);
      player.usedCards.push(false);
      player.blockedCards.push(false);
    }
    
    this.state.players.set(client.sessionId, player);
    
    // Update player count to reflect actual connected players
    this.state.playerCount = this.state.players.size;
    
    console.log(`Players in room: ${this.state.playerCount}`);
    
    // Start game when 2 players join
    if (this.state.playerCount === 2) {
      this.startNewRound();
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`Client ${client.sessionId} left`);
    
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // Remove player from the map
      this.state.players.delete(client.sessionId);
      
      // Update player count to reflect actual connected players
      this.state.playerCount = this.state.players.size;
      
      console.log(`Players in room after leave: ${this.state.playerCount}`);
      
      // If game was running, pause it
      if (this.state.gameStatus === "playing") {
        this.state.gameStatus = "waiting";
        this.state.game.phase = "waiting";
      }
    }
  }

  setupMessageHandlers() {
    // Betting messages
    this.onMessage("bet_submit", (client, message: { amount: number }) => {
      this.handleBetSubmit(client, message.amount);
    });
    
    this.onMessage("bet_confirm", (client) => {
      this.handleBetConfirm(client);
    });
    
    // Card selection messages
    this.onMessage("card_tap", (client, message: { cardIndex: number }) => {
      this.handleCardTap(client, message.cardIndex);
    });
    
    // Ready/start messages
    this.onMessage("player_ready", (client) => {
      this.handlePlayerReady(client);
    });
  }

  handleBetSubmit(client: Client, amount: number) {
    if (this.state.game.phase !== "betting") return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    // Clamp bet to available credits
    const clampedAmount = Math.max(0, Math.min(amount, player.credits));
    player.bet = clampedAmount;
    
    this.broadcast("bet_update", {
      playerId: player.playerId,
      amount: clampedAmount
    });
  }

  handleBetConfirm(client: Client) {
    if (this.state.game.phase !== "betting") return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player || player.betConfirmed) return;
    
    // Deduct credits and confirm bet
    player.credits -= player.bet;
    player.betConfirmed = true;
    this.state.game.pot += player.bet;
    
    this.broadcast("bet_confirmed", {
      playerId: player.playerId,
      bet: player.bet,
      remainingCredits: player.credits,
      pot: this.state.game.pot
    });
    
    // Check if both players confirmed
    const allPlayersConfirmed = Array.from(this.state.players.values())
      .every(p => p.betConfirmed);
    
    if (allPlayersConfirmed) {
      this.endBettingPhase();
    }
  }

  handleCardTap(client: Client, cardIndex: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    switch (this.state.game.phase) {
      case "starter_p1":
        this.handleStarterP1(client, cardIndex);
        break;
      case "starter_p2":
        this.handleStarterP2(client, cardIndex);
        break;
      case "choose_self":
        this.handleChooseSelf(client, cardIndex);
        break;
      case "choose_opponent":
        this.handleChooseOpponent(client, cardIndex);
        break;
    }
  }

  handleStarterP1(client: Client, cardIndex: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.playerId !== 1 || this.state.game.starterP1Idx !== -1) return;
    
    this.state.game.starterP1Idx = cardIndex;
    player.blockedCards[cardIndex] = true;
    
    this.broadcast("card_revealed", {
      playerId: 1,
      cardIndex: cardIndex,
      cardId: player.hand[cardIndex]
    });
    
    this.state.game.phase = "starter_p2";
    this.broadcast("phase_change", { phase: "starter_p2" });
  }

  handleStarterP2(client: Client, cardIndex: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.playerId !== 2 || this.state.game.starterP2Idx !== -1) return;
    
    this.state.game.starterP2Idx = cardIndex;
    player.blockedCards[cardIndex] = true;
    
    this.broadcast("card_revealed", {
      playerId: 2,
      cardIndex: cardIndex,
      cardId: player.hand[cardIndex]
    });
    
    // Resolve starter battle
    this.resolveStarterBattle();
  }

  handleChooseSelf(client: Client, cardIndex: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.playerId !== this.state.game.currentTurn) return;
    
    // Check if card is available
    if (player.usedCards[cardIndex] || player.blockedCards[cardIndex]) return;
    
    this.state.game.selectedSelf = cardIndex;
    
    this.broadcast("card_revealed", {
      playerId: player.playerId,
      cardIndex: cardIndex,
      cardId: player.hand[cardIndex]
    });
    
    this.state.game.phase = "choose_opponent";
    this.broadcast("phase_change", { phase: "choose_opponent" });
  }

  handleChooseOpponent(client: Client, cardIndex: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.playerId === this.state.game.currentTurn) return;
    
    // Check if card is available
    if (player.usedCards[cardIndex] || player.blockedCards[cardIndex]) return;
    
    this.state.game.selectedOpponent = cardIndex;
    
    this.broadcast("card_revealed", {
      playerId: player.playerId,
      cardIndex: cardIndex,
      cardId: player.hand[cardIndex]
    });
    
    // Resolve battle after short delay
    setTimeout(() => {
      this.resolveBattle();
    }, 800);
  }

  handlePlayerReady(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    player.ready = true;
    
    const allPlayersReady = Array.from(this.state.players.values())
      .every(p => p.ready);
    
    if (allPlayersReady && this.state.playerCount === 2) {
      this.startNewRound();
    }
  }

  startNewRound() {
    console.log("Starting new round");
    
    this.state.gameStatus = "playing";
    this.state.game.round++;
    
    // Reset round state
    this.resetRoundState();
    
    // Build and shuffle deck
    this.buildDeck();
    
    // Deal cards to players
    this.dealCards();
    
    // Start betting phase
    this.startBettingPhase();
  }

  resetRoundState() {
    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.starterP1Idx = -1;
    this.state.game.starterP2Idx = -1;
    this.state.game.battleWinner = 0;
    this.state.game.battleDiff = 0;
    this.state.game.battleOp = "";
    this.state.game.pot = 0;
    this.state.game.afterStarter = false;
    
    // Reset player states
    Array.from(this.state.players.values()).forEach(player => {
      player.bet = 0;
      player.betConfirmed = false;
      
      // Reset card states
      for (let i = 0; i < 10; i++) {
        player.usedCards[i] = false;
        player.blockedCards[i] = false;
      }
    });
  }

  buildDeck() {
    this.state.game.deck.clear();
    
    // Create deck of cards 0-67
    const deck = [];
    for (let i = 0; i <= 67; i++) {
      deck.push(i);
    }
    
    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    // Store in state
    deck.forEach(card => this.state.game.deck.push(card));
    this.state.game.deckPos = 0;
    this.state.game.jokerValue = Math.floor(Math.random() * 68) + 1;
  }

  dealCards() {
    const players = Array.from(this.state.players.values()).sort((a, b) => a.playerId - b.playerId);
    
    // Deal 10 cards to each player
    let deckIndex = this.state.game.deckPos;
    
    for (let i = 0; i < 10; i++) {
      players[0].hand[i] = this.state.game.deck[deckIndex++];
      players[1].hand[i] = this.state.game.deck[deckIndex++];
    }
    
    this.state.game.deckPos = deckIndex;
    
    this.broadcast("cards_dealt", {
      jokerValue: this.state.game.jokerValue
    });
  }

  startBettingPhase() {
    this.state.game.phase = "betting";
    this.state.game.betTimeLeft = 15;
    
    this.broadcast("betting_started", {
      timeLeft: this.state.game.betTimeLeft
    });
    
    // Start betting timer
    const timer = setInterval(() => {
      this.state.game.betTimeLeft--;
      
      this.broadcast("betting_timer", {
        timeLeft: this.state.game.betTimeLeft
      });
      
      if (this.state.game.betTimeLeft <= 0) {
        clearInterval(timer);
        this.endBettingPhase();
      }
    }, 1000);
  }

  endBettingPhase() {
    // Auto-confirm any unconfirmed bets as 0
    Array.from(this.state.players.values()).forEach(player => {
      if (!player.betConfirmed) {
        player.bet = 0;
        player.betConfirmed = true;
      }
    });
    
    this.state.game.phase = "starter_p1";
    this.state.game.currentTurn = 1;
    
    this.broadcast("betting_ended", {
      pot: this.state.game.pot
    });
    
    this.broadcast("phase_change", { phase: "starter_p1" });
  }

  resolveStarterBattle() {
    const players = Array.from(this.state.players.values()).sort((a, b) => a.playerId - b.playerId);
    const p1 = players[0];
    const p2 = players[1];
    
    const p1Card = p1.hand[this.state.game.starterP1Idx];
    const p2Card = p2.hand[this.state.game.starterP2Idx];
    
    const p1Power = this.getCardPower(p1Card);
    const p2Power = this.getCardPower(p2Card);
    
    // Determine winner and update scores
    this.state.game.battleDiff = Math.abs(p1Power - p2Power);
    
    if (p1Power > p2Power) {
      this.state.game.battleWinner = 1;
      this.state.game.currentTurn = 1;
      this.updatePlayerScore(p1, this.state.game.battleDiff);
    } else if (p2Power > p1Power) {
      this.state.game.battleWinner = 2;
      this.state.game.currentTurn = 2;
      this.updatePlayerScore(p2, this.state.game.battleDiff);
    } else {
      this.state.game.battleWinner = 0;
      this.state.game.currentTurn = 1; // Keep current turn on tie
    }
    
    this.state.game.afterStarter = true;
    
    this.broadcast("battle_result", {
      winner: this.state.game.battleWinner,
      diff: this.state.game.battleDiff,
      p1Power: p1Power,
      p2Power: p2Power,
      nextTurn: this.state.game.currentTurn
    });
    
    // Move to card selection phase
    setTimeout(() => {
      this.state.game.phase = "choose_self";
      this.state.game.selectedSelf = -1;
      this.state.game.selectedOpponent = -1;
      this.broadcast("phase_change", { phase: "choose_self" });
    }, 2000);
  }

  resolveBattle() {
    const currentPlayer = Array.from(this.state.players.values())
      .find(p => p.playerId === this.state.game.currentTurn);
    const opponentPlayer = Array.from(this.state.players.values())
      .find(p => p.playerId !== this.state.game.currentTurn);
    
    if (!currentPlayer || !opponentPlayer) return;
    
    const selfCard = currentPlayer.hand[this.state.game.selectedSelf];
    const oppCard = opponentPlayer.hand[this.state.game.selectedOpponent];
    
    const selfPower = this.getCardPower(selfCard);
    const oppPower = this.getCardPower(oppCard);
    
    this.state.game.battleDiff = Math.abs(selfPower - oppPower);
    
    // Determine winner and update scores
    if (selfPower > oppPower) {
      this.state.game.battleWinner = this.state.game.currentTurn;
      this.updatePlayerScore(currentPlayer, this.state.game.battleDiff);
    } else if (oppPower > selfPower) {
      this.state.game.battleWinner = (this.state.game.currentTurn === 1) ? 2 : 1;
      this.updatePlayerScore(opponentPlayer, this.state.game.battleDiff);
    } else {
      this.state.game.battleWinner = 0; // Tie
    }
    
    // Mark cards as used
    currentPlayer.usedCards[this.state.game.selectedSelf] = true;
    opponentPlayer.usedCards[this.state.game.selectedOpponent] = true;
    
    this.broadcast("battle_result", {
      winner: this.state.game.battleWinner,
      diff: this.state.game.battleDiff,
      selfPower: selfPower,
      oppPower: oppPower
    });
    
    // Switch turns
    this.state.game.currentTurn = (this.state.game.currentTurn === 1) ? 2 : 1;
    
    // Check for round end
    setTimeout(() => {
      if (this.isRoundComplete()) {
        this.endRound();
      } else {
        this.state.game.phase = "choose_self";
        this.state.game.selectedSelf = -1;
        this.state.game.selectedOpponent = -1;
        this.broadcast("phase_change", { phase: "choose_self" });
      }
    }, 2000);
  }

  getCardPower(cardId: number): number {
    if (cardId === 0) {
      return this.state.game.jokerValue;
    }
    return cardId;
  }

  updatePlayerScore(player: Player, diff: number) {
    const currentScore = player.score;
    const addScore = currentScore + diff;
    const subScore = currentScore - diff;
    
    // Choose the operation that gets closer to target
    const targetDiff = this.state.game.targetScore;
    if (Math.abs(addScore - targetDiff) <= Math.abs(subScore - targetDiff)) {
      player.score = addScore;
      this.state.game.battleOp = "+";
    } else {
      player.score = subScore;
      this.state.game.battleOp = "-";
    }
  }

  isRoundComplete(): boolean {
    // Round is complete when both players have used all non-blocked cards
    const players = Array.from(this.state.players.values());
    
    for (const player of players) {
      let usedCount = 0;
      for (let i = 0; i < 10; i++) {
        if (player.usedCards[i] || player.blockedCards[i]) {
          usedCount++;
        }
      }
      if (usedCount < 10) {
        return false;
      }
    }
    
    return true;
  }

  endRound() {
    this.state.game.phase = "round_finished";
    
    // Award pot to winner or split on tie
    const players = Array.from(this.state.players.values()).sort((a, b) => a.playerId - b.playerId);
    const p1 = players[0];
    const p2 = players[1];
    
    const p1Distance = Math.abs(p1.score - this.state.game.targetScore);
    const p2Distance = Math.abs(p2.score - this.state.game.targetScore);
    
    if (p1Distance < p2Distance) {
      p1.credits += this.state.game.pot;
    } else if (p2Distance < p1Distance) {
      p2.credits += this.state.game.pot;
    } else {
      // Tie - split pot
      const halfPot = Math.floor(this.state.game.pot / 2);
      p1.credits += halfPot;
      p2.credits += this.state.game.pot - halfPot;
    }
    
    this.broadcast("round_ended", {
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
      pot: this.state.game.pot
    });
    
    // Check for game end or start new round
    setTimeout(() => {
      if (this.shouldEndGame()) {
        this.endGame();
      } else {
        this.startNewRound();
      }
    }, 3000);
  }

  shouldEndGame(): boolean {
    // End game if not enough cards for another round or if a player is out of credits
    const remainingCards = this.state.game.deck.length - this.state.game.deckPos;
    const players = Array.from(this.state.players.values());
    
    return remainingCards < 20 || players.some(p => p.credits <= 0);
  }

  endGame() {
    this.state.gameStatus = "finished";
    this.state.game.phase = "game_over";
    
    const players = Array.from(this.state.players.values()).sort((a, b) => a.playerId - b.playerId);
    
    this.broadcast("game_ended", {
      finalScores: players.map(p => ({
        playerId: p.playerId,
        score: p.score,
        credits: p.credits
      }))
    });
  }
}

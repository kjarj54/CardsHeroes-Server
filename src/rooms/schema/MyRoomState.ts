import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("number") playerId: number = 0; // 1 or 2
  @type("boolean") connected: boolean = false;
  @type("boolean") ready: boolean = false;
  @type("number") score: number = 0;
  @type("number") credits: number = 100;
  @type("number") bet: number = 0;
  @type("boolean") betConfirmed: boolean = false;
  @type(["number"]) hand: ArraySchema<number> = new ArraySchema<number>();
  @type(["boolean"]) usedCards: ArraySchema<boolean> = new ArraySchema<boolean>();
  @type(["boolean"]) blockedCards: ArraySchema<boolean> = new ArraySchema<boolean>();
}

export class GameState extends Schema {
  @type("string") phase: string = "waiting"; // waiting, betting, starter_p1, starter_p2, choose_self, choose_opponent, wait_flip, battle_result, round_finished, game_over
  @type("number") currentTurn: number = 1;
  @type("number") round: number = 1;
  @type("number") targetScore: number = 34;
  @type("number") jokerValue: number = 0;
  @type("number") betTimeLeft: number = 15;
  @type("number") pot: number = 0;
  
  // Selected cards for battle
  @type("number") selectedSelf: number = -1;
  @type("number") selectedOpponent: number = -1;
  @type("number") starterP1Idx: number = -1;
  @type("number") starterP2Idx: number = -1;
  
  // Battle results
  @type("number") battleWinner: number = 0; // 0 = tie, 1 = player1, 2 = player2
  @type("number") battleDiff: number = 0;
  @type("string") battleOp: string = ""; // "+" or "-"
  
  // Deck management
  @type(["number"]) deck: ArraySchema<number> = new ArraySchema<number>();
  @type("number") deckPos: number = 1;
  
  // Special abilities
  @type("boolean") drManhattanActive: boolean = false;
  @type("number") drManhattanTimeLeft: number = 0;
  
  // Flags
  @type("boolean") afterStarter: boolean = false;
}

export class MyRoomState extends Schema {
  @type({ map: Player }) players: MapSchema<Player> = new MapSchema<Player>();
  @type(GameState) game: GameState = new GameState();
  @type("number") playerCount: number = 0;
  @type("string") gameStatus: string = "waiting"; // waiting, playing, finished
}

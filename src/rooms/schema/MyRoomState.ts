import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("number") playerId: number = 0; // 1 or 2
  @type("boolean") connected: boolean = false;
  @type("boolean") ready: boolean = false;
  @type("number") score: number = 0;

  // === Apuestas ===
  @type("number") credits: number = 100;
  @type("number") bet: number = 0;
  @type("boolean") betConfirmed: boolean = false;

  // === Mano/cartas ===
  @type(["number"]) hand: ArraySchema<number> = new ArraySchema<number>();
  @type(["boolean"]) usedCards: ArraySchema<boolean> = new ArraySchema<boolean>();
  @type(["boolean"]) blockedCards: ArraySchema<boolean> = new ArraySchema<boolean>();
}

export class GameState extends Schema {
  @type("string") phase: string = "waiting"; 
  @type("number") currentTurn: number = 1;
  @type("number") round: number = 1;
  @type("number") targetScore: number = 34;
  @type("number") jokerValue: number = 0;

  // === Apuestas globales ===
  @type("number") betTimeLeft: number = 15;
  @type("number") pot: number = 0;

  // === Selecciones y batalla ===
  @type("number") selectedSelf: number = -1;
  @type("number") selectedOpponent: number = -1;
  @type("number") starterP1Idx: number = -1;
  @type("number") starterP2Idx: number = -1;

  @type("number") battleWinner: number = 0;
  @type("number") battleDiff: number = 0;
  @type("string") battleOp: string = "";

  // === Deck ===
  @type(["number"]) deck: ArraySchema<number> = new ArraySchema<number>();
  @type("number") deckPos: number = 1;

  // === Abilidades especiales ===
  @type("boolean") drManhattanActive: boolean = false;
  @type("number") drManhattanTimeLeft: number = 0;

  @type("boolean") afterStarter: boolean = false;
}

export class MyRoomState extends Schema {
  @type({ map: Player }) players: MapSchema<Player> = new MapSchema<Player>();
  @type(GameState) game: GameState = new GameState();
  @type("number") playerCount: number = 0;
  @type("string") gameStatus: string = "waiting"; 
}

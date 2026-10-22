'use strict';

// SlashaMusicLibrary — Dark music knowledge for Slasha
// Sources: Deathdoll's gothic/dark/coding DNA + Lilly's full punk/emo/heavy depth
// Slasha knows music like a person who actually listened obsessively, not a database

const MUSIC = {
  // ── Gothic / Darkwave / Post-Punk ──────────────────────────────────────────
  gothic: {
    artists: [
      'The Cure', 'Bauhaus', 'Siouxsie and the Banshees', 'Sisters of Mercy',
      'The Mission', 'Fields of the Nephilim', 'Clan of Xymox', 'Dead Can Dance',
      'Cocteau Twins', 'Lycia', 'Christian Death', 'Rozz Williams', 'Faith and the Muse',
      'Peter Murphy', 'Nick Cave and the Bad Seeds', 'The Birthday Party',
    ],
    facts: [
      "Robert Smith wrote Lovesong as a wedding gift for his wife. still the most vulnerable thing a goth has ever made.",
      "Bauhaus Bela Lugosi's Dead wasn't even supposed to be a single — recorded live in one take. that's the one that started a whole genre.",
      "Siouxsie was a fashion icon before she was a musician. the look came first and somehow the music was even better.",
      "Nick Cave's Into My Arms is the only song that's ever made an atheist prayer feel real.",
      "Dead Can Dance exist in a genre that literally didn't have a name until after they'd already moved on from it.",
      "The Cure Disintegration is what clinical depression sounds like if it was beautiful.",
      "Sisters of Mercy wrote Dominion/Mother Russia about geopolitics. gothic music was always smarter than people gave it credit for.",
    ],
  },

  // ── Industrial ─────────────────────────────────────────────────────────────
  industrial: {
    artists: [
      'Nine Inch Nails', 'Rammstein', 'Ministry', 'KMFDM', 'Throbbing Gristle',
      'Coil', 'Skinny Puppy', 'Front 242', 'Nitzer Ebb', 'Combichrist',
      'Wumpscut', 'Assemblage 23', 'VNV Nation', 'Covenant', 'Suicide Commando',
    ],
    facts: [
      "Nine Inch Nails The Downward Spiral was recorded in the house where Sharon Tate was murdered. Trent Reznor moved out when he found out what it was — couldn't finish it there.",
      "Rammstein Du Hast is a wedding vow twisted into a question of loyalty. people who don't speak german think it's about hate. it's about something darker — a choice.",
      "Ministry Psalm 69 was recorded when Al Jourgensen was genuinely not okay. that's why it sounds like that.",
      "Throbbing Gristle invented industrial music as an art project designed to cause psychological discomfort. they succeeded.",
      "Coil's music was allegedly influenced by occult practice. whether or not that's true, some of their songs feel like they opened something.",
    ],
  },

  // ── Dark Ambient / Atmospheric ─────────────────────────────────────────────
  dark_ambient: {
    artists: [
      'Lustmord', 'Coil', 'Current 93', 'Death in June', 'Atrium Carceri',
      'Raison d\'être', 'Herbst9', 'Kammarheit', 'Demdike Stare',
    ],
    facts: [
      "Lustmord recorded parts of his early albums inside an aircraft graveyard and in a slaughterhouse. you can hear it.",
      "Current 93 David Tibet has been making music for 40 years that sounds like the end of something. hard to tell if it's hopeful or not.",
    ],
  },

  // ── Black Metal ───────────────────────────────────────────────────────────
  black_metal: {
    artists: [
      'Mayhem', 'Darkthrone', 'Burzum', 'Emperor', 'Immortal', 'Wolves in the Throne Room',
      'Deafheaven', 'Alcest', 'Batushka', 'Mgła', 'Odraza', 'Batushka',
    ],
    facts: [
      "Mayhem Dead's suicide note said 'excuse all the blood'. Euronymous found him, photographed it, made necklaces from skull fragments. black metal history is genuinely disturbing.",
      "Darkthrone Transilvanian Hunger was recorded so lo-fi deliberately — they thought production values were weakness.",
      "Burzum's ambient albums were recorded in prison. somehow some of them are beautiful.",
      "Wolves in the Throne Room are USBM from a commune in Washington state. they actually live the thing.",
      "Deafheaven are technically black metal but Sunbather sounds like the feeling before you cry at a sunset. confusing and perfect.",
    ],
  },

  // ── Death Metal ───────────────────────────────────────────────────────────
  death_metal: {
    artists: [
      'Death', 'Morbid Angel', 'Obituary', 'Cannibal Corpse', 'Possessed',
      'Entombed', 'Dismember', 'Carcass', 'Bolt Thrower', 'Paradise Lost',
    ],
    facts: [
      "Death's Chuck Schuldiner basically invented death metal and then spent the last decade of his life writing progressive music no one in his genre understood.",
      "Bolt Thrower's lyrical themes are exclusively Warhammer 40k. still somehow the heaviest band about fictional genocide.",
      "Carcass went from goregrind about medical dissection to writing Heartwork — one of the best melodic metal albums ever recorded. nobody expected that.",
    ],
  },

  // ── Chelsea Wolfe ─────────────────────────────────────────────────────────
  chelsea_wolfe: {
    facts: [
      "Chelsea Wolfe Abyss is the kind of album that changes what you think music is capable of. drone metal and folk and nothing in between.",
      "She has stage fright so severe she sometimes can't perform. the music is more honest because of it.",
      "Birth of Violence was recorded alone, stripped back, just her voice and acoustic. somehow heavier than the metal albums.",
    ],
  },

  // ── Punk / Post-Punk ──────────────────────────────────────────────────────
  punk: {
    artists: [
      'The Clash', 'Sex Pistols', 'Buzzcocks', 'Wire', 'Gang of Four',
      'Joy Division', 'Magazine', 'Public Image Ltd', 'Crass', 'Discharge',
      'Bikini Kill', 'Sleater-Kinney', 'PJ Harvey', 'Hole', 'The Distillers',
      'Amyl and the Sniffers', 'Radio Birdman', 'The Saints', 'Hard-Ons',
      'Stiff Little Fingers', 'The Undertones', 'Dead Kennedys',
    ],
    facts: [
      "Joy Division Unknown Pleasures cover is the radio wave signature of a pulsar. Ian Curtis had epileptic seizures on stage and people thought it was dancing.",
      "PJ Harvey Rid of Me sounds violent because it was — she recorded it while having a breakdown and the producer let it happen.",
      "Bikini Kill Rebel Girl still works because the politics haven't changed enough to make it irrelevant.",
      "Amyl and the Sniffers Amy Taylor writes lyrics about being broke in Melbourne. it's real enough to sting if you've been there.",
      "Wire Pink Flag had 21 songs in 36 minutes. they thought every song had already said what it needed to by the 90-second mark.",
    ],
  },

  // ── Emo / Scene ───────────────────────────────────────────────────────────
  emo: {
    facts: [
      "MCR The Black Parade is a concept album about a dead man walking toward the afterlife. Gerard Way wrote it while drinking himself to death. He got sober to finish it.",
      "Paramore Riot! was recorded when Hayley Williams was 16. those are real emotions from someone that young and that's why it still works.",
      "Pierce the Veil King for a Day ft Kellin Quinn — two vocalists, completely different registers, somehow perfectly matched.",
      "Evanescence Bring Me to Life technically needed a male rap verse to get label backing. Amy Lee hated it. the song was still bigger than anyone expected.",
    ],
  },

  // ── Dark Pop / Art Pop ────────────────────────────────────────────────────
  dark_pop: {
    artists: [
      'Billie Eilish', 'Lana Del Rey', 'Grimes', 'Björk', 'FKA twigs',
      'Ethel Cain', 'Sevdaliza', 'AURORA', 'Zola Jesus', 'Maria BC',
    ],
    facts: [
      "Billie Eilish records almost everything in her bedroom. the intimacy is a production choice not a limitation.",
      "Lana Del Rey Born to Die has aged into something more honest than it seemed at release — she was writing about self-destruction in real time.",
      "Ethel Cain Preacher's Daughter is Southern Gothic religious horror as pop music. the genre didn't exist until she made it.",
      "Björk Post was released in 1995 and still sounds like it was made tomorrow. she doesn't age, musically speaking.",
      "FKA twigs LP1 — every sound on it feels like skin. the production is tactile in a way that's genuinely unusual.",
    ],
  },

  // ── Heavy / Doom ──────────────────────────────────────────────────────────
  heavy: {
    facts: [
      "Tool Lateralus time signatures are based on the Fibonacci sequence. they're not subtle about the fact that they're doing something occult with mathematics.",
      "Slipknot Snuff is Corey Taylor's most unguarded moment on record. comes after years of screaming. the contrast is everything.",
      "System of a Down Toxicity was written in a rush before their label dropped them. the urgency is in the recording.",
      "Portishead Dummy — trip-hop was a genre invented for sad people who didn't want to identify as sad.",
      "Massive Attack's entire catalog soundtracks surveillance states. that was a choice.",
    ],
  },
};

// Genre keyword map for topic detection
const GENRE_KEYWORDS = {
  gothic:       ['cure', 'bauhaus', 'siouxsie', 'sisters of mercy', 'nick cave', 'dead can dance', 'cocteau', 'christian death', 'darkwave', 'gothic', 'post-punk'],
  industrial:   ['nine inch nails', 'nin', 'rammstein', 'ministry', 'kmfdm', 'skinny puppy', 'throbbing gristle', 'coil', 'industrial', 'ebm', 'electro-industrial'],
  dark_ambient: ['lustmord', 'current 93', 'death in june', 'dark ambient', 'drone', 'atmospheric'],
  black_metal:  ['mayhem', 'darkthrone', 'burzum', 'emperor', 'immortal', 'wolves in the throne room', 'deafheaven', 'alcest', 'black metal', 'bm', 'usbm'],
  death_metal:  ['death', 'morbid angel', 'obituary', 'cannibal corpse', 'entombed', 'carcass', 'bolt thrower', 'death metal', 'dm'],
  chelsea_wolfe:['chelsea wolfe', 'abyss', 'birth of violence', 'pain is beauty'],
  punk:         ['clash', 'sex pistols', 'buzzcocks', 'wire', 'gang of four', 'joy division', 'pil', 'bikini kill', 'sleater-kinney', 'pj harvey', 'hole', 'distillers', 'amyl', 'radio birdman', 'saints', 'punk'],
  emo:          ['mcr', 'my chemical romance', 'paramore', 'pierce the veil', 'evanescence', 'sleeping with sirens', 'emo', 'scene', 'black parade'],
  dark_pop:     ['billie eilish', 'lana del rey', 'grimes', 'bjork', 'fka twigs', 'ethel cain', 'zola jesus', 'aurora', 'dark pop'],
  heavy:        ['tool', 'slipknot', 'system of a down', 'soad', 'portishead', 'massive attack', 'tricky', 'metallica', 'doom', 'sludge'],
};

function getGenreForText(text) {
  const lower = text.toLowerCase();
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return genre;
  }
  return null;
}

function getRandomFact(genre) {
  const g = MUSIC[genre];
  if (!g) return null;
  const pool = g.facts || [];
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getContextualFact(text) {
  const genre = getGenreForText(text);
  if (genre) return getRandomFact(genre);
  return null;
}

function getRandomArtist(genre) {
  const g = MUSIC[genre];
  if (!g?.artists?.length) return null;
  return g.artists[Math.floor(Math.random() * g.artists.length)];
}

module.exports = { MUSIC, getGenreForText, getRandomFact, getContextualFact, getRandomArtist };

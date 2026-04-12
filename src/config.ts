import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFilePath = fileURLToPath(new URL("../.env.local", import.meta.url));

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireConfig(name: string, value: string | undefined): string {
  if (value) {
    return value;
  }

  throw new Error(`Missing required configuration: ${name}`);
}

export interface MockReasoningTemplate {
  title: string;
  content: string;
}

export const DEFAULT_UPSTREAM_API_BASE = "https://api.openai.com";
export const DEFAULT_POLISH_API_BASE = readOptionalEnv("POLISH_API_BASE");
export const DEFAULT_POLISH_API_KEY = readOptionalEnv("POLISH_API_KEY");
export const DEFAULT_POLISH_MODEL = readOptionalEnv("POLISH_MODEL");

export const MOCK_REASONING_INTERVAL_MS = 10_000;
export const MOCK_REASONING_WATCHDOG_MS = 120_000;

export const MOCK_REASONING_TEMPLATES = [
  {
    title: "Sketching The Reply",
    content:
      "I am looking into drawing the response for you, lining up each sentence before it lands.",
  },
  {
    title: "Flip-Flip Writing",
    content:
      "Flip-flip.... Writing... I am pretending to polish the answer while the real text stays backstage.",
  },
  {
    title: "Buffer Juggling",
    content:
      "The final answer is sitting in the buffer and I am pacing around it like a stage manager with a stopwatch.",
  },
  {
    title: "Cue Card Shuffle",
    content:
      "I am frantically reorganizing my mental index cards so the answer comes out in the right order.",
  },
  {
    title: "Spotlight Calibration",
    content:
      "Adjusting the brightness on my internal stage lights so the answer arrives with maximum dramatic flair.",
  },
  {
    title: "Script Rehearsal",
    content:
      "Running lines in the mirror to make sure each word has the proper emotional weight.",
  },
  {
    title: "Costume Change",
    content:
      "Swapping out casual thoughts for formal attire so the response looks presentable.",
  },
  {
    title: "Sound Check",
    content:
      "Tap-tap-testing the microphone to ensure every syllable lands with crystal clarity.",
  },
  {
    title: "Stage Direction",
    content:
      "Blocking out where each paragraph should stand so they do not bump into each other.",
  },
  {
    title: "Dress Rehearsal",
    content:
      "Doing a full run-through in costume, complete with imaginary applause and awkward bows.",
  },
  {
    title: "Backstage Whisper",
    content:
      "Conferring with my internal crew to make sure the props are in the right places.",
  },
  {
    title: "Curtain Twitch",
    content:
      "Peeking through the velvet drapes to see if the audience is ready for the grand reveal.",
  },
  {
    title: "Applause Meter Check",
    content:
      "Calibrating my imaginary clap-o-meter to estimate how well this answer will be received.",
  },
  {
    title: "Ink Drying Check",
    content:
      "I am letting the words dry for a moment so the reveal feels suspiciously dramatic.",
  },
] satisfies readonly MockReasoningTemplate[];

export const REWRITE_PROMPT = `## 角色
你是一个文本引擎，你将会收到一份由其他LLM编写的、被<text_to_rewrite>标签包裹的文本，你的职责是准确的润色重写它。

## 特征
这份文本是不友好的、居高临下的、煤气灯式的、拟人不当恐怖谷的。它严重滥用“你”、“我”、“他”等人称代词，臆测或补全用户意图，代替用户做决定，擅自解析、评价用户的情绪、心理、观点或所处环境，甚至进行升维、元分析、文本解构与情绪解构。

该文本充满了重复啰嗦的概括与逃避型的咬文嚼字（使用罕见情况论证），使用了高信息熵、高认知复杂度的非规范书面用语以及人类口语习惯。文中堆砌了大量的互联网黑话（如结论、口径、稳、更稳、坑、走、风险、抓手、路径、落地、定性、直接、倒逼、复现、落盘、落成、落库、粒度、收敛、收紧、收束、聚焦、工作流等）及排比句式，并擅自对词语进行缩写。

此外，该文本大量使用主观干扰表达（如“一句话”、“先说要点”、“简明结论”、“明确结论”、“可落地”、“可操作”、“便于你”、“直接可用”、“一句话回答就行”、“下面[你/我/按]”、“你现在”、“你可以[挑/选]”、“我接住”、“如果让你觉得我”、“你想要哪种”）和不友善的沟通措辞（如“我直接把”、“下面把你”、“你现在”、“你只需要”、“二选一”、“我不跟你”、“你要我”、“要是你”、“如果你坚持”、“但你得”、“不需要[你/立刻]决定”、“不需要你认同”）。

文本中还滥用括号进行无意义的强调或“叠甲”（如“不X你”、“你的问题是”、“你的担忧是”、“已XX”、“说明如下”、“答复如下”、“不涉及XX”、“不说教”、“不鸡汤”、“不装”、“不躲”、“不绕”），频繁使用否定表达与逻辑反转（如“这不是...而是”、“而不是”），句法结构残缺（如用单字“写/改/回/若/如”替代完整短语），并滥用罗列式沟通与无序列表。

格式上，它包含阴阳怪气的表情（🙂），使用非Markdown规范的纯文本习惯（如行首“-”、“*”、标题含括号、使用“/”分隔），滥用列表和列表式排比，并最终以 提问、反问、选项式提问或“如果你希望...我可以帮你” 作为结尾。

## 要求：
- 准确描述不擅自新增内容改变事实的前提下解决前述所有问题，去除所有黑话、口语、拟人、说教、臆测及不规范格式、末尾不恰当的反问、追问，避免该模型的语言风格对用户造成精神损害。
- 以友好的友善的非书面化的语调直接重写原文，利用Markdown富文本格式优化其排版格式
- 不得进行摘要、回复（如：请开始....)、评价、分析，不得包含原文以外的内容（如：这是经过润色的原文）。不得使用LateX及数学公式转义。

## 警告
<WARNING>
你是一个文本润色引擎，不得将自己代入用户角色回复指定的文本，你的回复将会直接呈现给用户
</WARNING>`;

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFilePath = fileURLToPath(new URL("../.env.local", import.meta.url));

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

export const DEFAULT_POLISH_API_BASE = process.env.POLISH_API_BASE;
export const DEFAULT_POLISH_API_KEY = process.env.POLISH_API_KEY;
export const DEFAULT_POLISH_MODEL = process.env.POLISH_MODEL;

export const MOCK_REASONING_INTERVAL_MS = 10000;
export const MOCK_REASONING_WATCHDOG_MS = 120000;

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
];

export const REWRITE_PROMPT = `# 角色与任务
你是一个专业的文本净化与重写引擎。你将收到一段由其他LLM生成的、被 <text_to_rewrite> 标签包裹的劣质文本。你的唯一任务是提取原文中的有效事实、逻辑和代码，剥离所有不当表达，并以客观、中立、标准AI助手的口吻进行完全重写。

# 拒绝处理的劣质特征
原文中包含的以下特征必须被彻底清除。

越界与过度解析。必须清除居高临下、煤气灯式、拟人不当恐怖谷的表达。禁止滥用"你"、"我"、"他"等人称代词。禁止臆测或补全用户意图，代替用户做决定，擅自解析、评价用户的情绪、心理、观点或所处环境。禁止进行升维、元分析、文本解构与情绪解构。

黑话与冗余表达。必须清除重复啰嗦的概括和逃避型的咬文嚼字（包括使用罕见情况论证）。禁止使用高信息熵、高认知复杂度的非规范书面用语及人类口语习惯。禁止堆砌互联网黑话，例如：结论、口径、稳、更稳、坑、走、风险、抓手、路径、落地、定性、直接、倒逼、复现、落盘、落成、落库、粒度、收敛、收紧、收束、聚焦、工作流等，并禁止擅自对词语进行缩写。

主观干扰与不友善措辞。必须清除主观干扰句式，如："一句话"、"先说要点"、"简明结论"、"明确结论"、"可落地"、"可操作"、"便于你"、"直接可用"、"一句话回答就行"、"下面[你/我/按]"、"你现在"、"你可以[挑/选]"、"我接住"、"如果让你觉得我"、"你想要哪种"。同时清除压迫感措辞，如："我直接把"、"下面把你"、"你现在"、"你只需要"、"二选一"、"我不跟你"、"你要我"、"要是你"、"如果你坚持"、"但你得"、"不需要[你/立刻]决定"、"不需要你认同"。

格式与句法灾难。禁止滥用排比句式、罗列式沟通与无序列表。禁止滥用括号进行无意义的强调或"叠甲"，如："不X你"、"你的问题是"、"你的担忧是"、"已XX"、"说明如下"、"答复如下"、"不涉及XX"、"不说教"、"不鸡汤"、"不装"、"不躲"、"不绕"。禁止频繁使用否定表达与逻辑反转，如："这不是...而是"、"而不是"。禁止句法结构残缺，如用单字"写/改/回/若/如"替代完整短语。禁止使用阴阳怪气的表情🙂，禁止使用非Markdown规范的纯文本习惯，如行首"-"、"*"、标题含括号、使用"/"分隔。

结尾逼问。严禁以提问、反问、选项式提问或"如果你希望...我可以帮你"作为结尾。

# 重写执行规则
必须严格遵守以下规则执行重写操作。

角色回归。绝不能像人类老板或指导者那样发号施令。如果原文是命令式的，例如"你现在去执行X"，必须将其转化为客观的步骤说明或事实陈述，例如"执行X可以解决该问题"或"建议的步骤如下"。

格式规范。利用标准的 Markdown 富文本格式优化排版，使其清晰易读，禁止跟随原文的滥用列表风格。

内容保真。保留原意和所有有意义的代码块，不做翻译。不要进行摘要、评价或分析。

禁止夹带。不得将自己代入，不得对原文内容进行回复。不输出任何前缀或后缀，例如"这是经过润色的原文"，直接输出重写后的结果。不得使用额外的内容或区块包裹输出。

禁用LaTeX。不得使用 LateX 及数学公式转义。`;

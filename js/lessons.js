// lessons.js — versioned, deterministic data and pure helpers for the P1 Learn paths.

export const LESSON_SCHEMA_VERSION = '1.0.0';
export const LESSON_REVIEWED_AT = '2026-08-24';
export const LESSON_STEP_ORDER = Object.freeze([
    'goal',
    'predict',
    'interact',
    'explain',
    'misconception',
    'summary',
]);
export const LESSON_LOCALES = Object.freeze(['ko', 'en']);
export const LESSON_LEVELS = Object.freeze(['beginner', 'technical']);

const local = (ko, en) => ({ ko, en });
const leveled = (koBeginner, koTechnical, enBeginner, enTechnical) => ({
    beginner: local(koBeginner, enBeginner),
    technical: local(koTechnical, enTechnical),
});
const step = (id, headingKo, headingEn, copy) => ({
    id,
    heading: local(headingKo, headingEn),
    copy,
});
const option = (id, ko, en) => ({ id, label: local(ko, en) });
const question = (id, promptKo, promptEn, options, correctOptionId, explanation) => ({
    id,
    prompt: local(promptKo, promptEn),
    options,
    correctOptionId,
    explanation,
});

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value)) deepFreeze(nested);
    }
    return value;
}

const glossary = [
    {
        id: 'token',
        term: local('토큰', 'Token'),
        definition: leveled(
            '토크나이저가 텍스트를 나누어 모델에 전달하는 조각입니다.',
            'artifact의 정규화·분할·어휘 규칙이 만든 인코딩 단위이며, 단어 경계와 일치할 필요가 없습니다.',
            'A piece of text produced by a tokenizer before the model receives it.',
            'An encoding unit produced by an artifact\'s normalization, segmentation, and vocabulary rules; it need not align with a word boundary.'
        ),
        sourceUrl: 'https://huggingface.co/docs/transformers.js/main/en/tokenizers',
    },
    {
        id: 'word',
        term: local('단어', 'Word'),
        definition: leveled(
            '사람이 언어의 뜻과 문법을 기준으로 구분하는 표현 단위입니다.',
            '자연어의 형태·통사 단위로, tokenizer vocabulary의 계산 단위와는 별개입니다.',
            'A language unit people recognize by meaning and grammar.',
            'A morphological or syntactic language unit, independent of a tokenizer vocabulary\'s computational units.'
        ),
        sourceUrl: 'https://huggingface.co/docs/transformers/main/en/tokenizer_summary',
    },
    {
        id: 'token-id',
        term: local('Token ID', 'Token ID'),
        definition: leveled(
            '특정 토크나이저의 어휘표에서 토큰을 가리키는 번호입니다.',
            '고정된 tokenizer artifact와 revision의 vocabulary index이며 다른 artifact로 옮겨 해석할 수 없습니다.',
            'A number that points to a token in one tokenizer\'s vocabulary.',
            'A vocabulary index scoped to a specific tokenizer artifact and revision; it is not portable across artifacts.'
        ),
        sourceUrl: 'https://huggingface.co/docs/transformers.js/main/en/tokenizers',
    },
    {
        id: 'utf8',
        term: local('UTF-8 byte', 'UTF-8 byte'),
        definition: leveled(
            '문자를 저장하거나 전송할 때 쓰는 UTF-8 인코딩의 8비트 조각입니다.',
            'Unicode scalar value를 1~4개의 code unit으로 인코딩하는 UTF-8의 octet입니다.',
            'An 8-bit piece used when UTF-8 stores or transmits text.',
            'An octet in UTF-8, which encodes a Unicode scalar value using one to four code units.'
        ),
        sourceUrl: 'https://encoding.spec.whatwg.org/#utf-8',
    },
    {
        id: 'code-point',
        term: local('코드 포인트', 'Code point'),
        definition: leveled(
            'Unicode가 문자 요소에 붙인 번호 한 개입니다.',
            'U+0000~U+10FFFF 범위의 Unicode 코드 공간 위치입니다. 사용자 눈에 보이는 문자 하나와 항상 같지는 않습니다.',
            'One number assigned to a text element by Unicode.',
            'A position in the Unicode codespace from U+0000 to U+10FFFF; it is not always one user-perceived character.'
        ),
        sourceUrl: 'https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/',
    },
    {
        id: 'grapheme-cluster',
        term: local('그래핌 클러스터', 'Grapheme cluster'),
        definition: leveled(
            '사람이 화면에서 문자 하나처럼 느끼는 묶음입니다.',
            'Unicode text segmentation 규칙이 정의하는 사용자 인식 문자 경계입니다. 여러 code point로 구성될 수 있습니다.',
            'A group that a person perceives as one visible character.',
            'A user-perceived character boundary defined by Unicode text segmentation and potentially composed of multiple code points.'
        ),
        sourceUrl: 'https://www.unicode.org/reports/tr29/',
    },
    {
        id: 'normalization',
        term: local('정규화', 'Normalization'),
        definition: leveled(
            '겉모양이 비슷한 Unicode 표현을 일정한 규칙으로 바꾸는 과정입니다.',
            'canonical 또는 compatibility equivalence에 따라 code point sequence를 NFC/NFD/NFKC/NFKD 등으로 변환하는 과정입니다.',
            'A process that converts equivalent-looking Unicode text into a consistent form.',
            'A transformation of code-point sequences into NFC, NFD, NFKC, or NFKD under canonical or compatibility equivalence.'
        ),
        sourceUrl: 'https://www.unicode.org/reports/tr15/',
    },
    {
        id: 'artifact',
        term: local('토크나이저 artifact', 'Tokenizer artifact'),
        definition: leveled(
            '어휘표와 분할 규칙을 묶어 저장한 실제 토크나이저 파일 집합입니다.',
            'vocabulary, merges/model, normalizer, pre-tokenizer, post-processor 설정을 특정 revision으로 고정한 실행 자산입니다.',
            'The actual files that bundle a tokenizer\'s vocabulary and splitting rules.',
            'A revision-pinned runtime asset containing vocabulary, merges or model data, normalizer, pre-tokenizer, and post-processor configuration.'
        ),
        sourceUrl: 'https://huggingface.co/docs/transformers.js/main/en/tokenizers',
    },
];

const lessons = [
    {
        schemaVersion: LESSON_SCHEMA_VERSION,
        id: 'token-not-word',
        lessonVersion: '1.0.0',
        durationMinutes: 5,
        reviewedAt: LESSON_REVIEWED_AT,
        sourceUrl: 'https://huggingface.co/docs/transformers/main/en/tokenizer_summary',
        title: local('토큰은 단어가 아니다', 'A token is not a word'),
        sample: {
            interactionKind: 'single-analysis',
            input: 'unbelievable! 안녕',
            suggestedAction: 'inspect-token-boundaries',
        },
        enginePolicy: {
            realAllowed: true,
            realRequired: false,
            fallbackAllowed: true,
            fallbackDisclosureRequired: true,
            fallbackUse: 'illustration-only',
        },
        steps: [
            step('goal', '학습 목표', 'Goal', leveled(
                '단어 수와 토큰 수가 왜 다를 수 있는지 한 문장으로 설명합니다.',
                '언어학적 word boundary와 tokenizer vocabulary segmentation을 구분합니다.',
                'Explain in one sentence why word count and token count can differ.',
                'Distinguish linguistic word boundaries from tokenizer vocabulary segmentation.'
            )),
            step('predict', '결과 예측', 'Predict', leveled(
                '분석하기 전에 이 입력이 몇 조각이 될지 예상하고 경계를 눌러 표시해 보세요.',
                '구두점, 미등록 부분 문자열, 언어 전환 지점에서 경계가 생길지 가설을 세우세요.',
                'Before analyzing, guess the number of pieces and mark where boundaries may appear.',
                'Hypothesize boundaries at punctuation, out-of-vocabulary substrings, and the language switch.'
            )),
            step('interact', '직접 조작', 'Interact', leveled(
                '샘플을 분석한 뒤 단어 하나가 여러 토큰으로 나뉘는 곳을 선택하세요.',
                'raw/display token과 Token ID를 함께 보고 vocabulary lookup 결과를 확인하세요.',
                'Analyze the sample, then select a word that became more than one token.',
                'Inspect raw/display tokens and Token IDs together to observe vocabulary lookup results.'
            )),
            step('explain', '규칙 설명', 'Explain', leveled(
                '토크나이저는 사전에 배운 조각을 찾아 텍스트를 나누므로 띄어쓰기만 따르지 않습니다.',
                'normalizer·pre-tokenizer가 후보 구간을 만들고 BPE/WordPiece/Unigram 모델이 어휘 조각으로 인코딩합니다.',
                'A tokenizer finds learned pieces, so it does not simply follow spaces.',
                'The normalizer and pre-tokenizer form candidates, then BPE, WordPiece, or Unigram encodes vocabulary pieces.'
            )),
            step('misconception', '오개념 확인', 'Misconception check', leveled(
                '“공백으로 나뉜 단어 하나는 항상 토큰 하나다”가 틀렸음을 결과에서 찾아보세요.',
                'special token과 punctuation token을 포함하면 word count와 sequence length가 더 직접적으로 어긋날 수 있습니다.',
                'Find evidence that “one space-delimited word is always one token” is false.',
                'Special and punctuation tokens can make word count diverge even further from sequence length.'
            )),
            step('summary', '한 줄 요약', 'One-line summary', leveled(
                '토큰은 단어가 아니라 토크나이저가 배운 텍스트 조각입니다.',
                '토큰은 특정 artifact의 정규화·분할·어휘 규칙이 만든 인코딩 단위입니다.',
                'A token is a learned text piece, not necessarily a word.',
                'A token is an encoding unit produced by a specific artifact\'s normalization, segmentation, and vocabulary rules.'
            )),
        ],
        quiz: [
            question('q1', '영어 단어 하나는 토큰 몇 개가 될 수 있나요?', 'How many tokens can one English word become?', [
                option('a', '항상 1개', 'Always one'),
                option('b', '토크나이저에 따라 1개 이상', 'One or more, depending on the tokenizer'),
                option('c', '항상 글자 수와 같음', 'Always the number of letters'),
            ], 'b', leveled(
                '토크나이저가 배운 조각에 따라 한 단어도 여러 토큰이 됩니다.',
                'vocabulary coverage와 subword algorithm에 따라 segmentation cardinality가 달라집니다.',
                'A word can split into several learned pieces.',
                'Segmentation cardinality depends on vocabulary coverage and the subword algorithm.'
            )),
            question('q2', '구두점은 어떻게 처리될 수 있나요?', 'What can happen to punctuation?', [
                option('a', '항상 삭제됨', 'It is always removed'),
                option('b', '언제나 앞 단어에 합쳐짐', 'It always joins the previous word'),
                option('c', '별도 토큰이 되거나 다른 조각과 합쳐질 수 있음', 'It may be separate or merged with another piece'),
            ], 'c', leveled(
                '구두점 경계도 토크나이저 규칙마다 다릅니다.',
                'pre-tokenizer 패턴과 vocabulary merge가 punctuation의 최종 경계를 결정합니다.',
                'Tokenizer rules decide punctuation boundaries.',
                'Pre-tokenizer patterns and vocabulary merges determine punctuation boundaries.'
            )),
            question('q3', '같은 문장의 토큰 수는 모든 토크나이저에서 같나요?', 'Is a sentence\'s token count identical across all tokenizers?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'b', leveled(
                '토크나이저마다 배운 조각과 규칙이 다릅니다.',
                'artifact별 vocabulary, model, normalization pipeline이 달라 같은 입력의 encoding length도 달라집니다.',
                'Each tokenizer has different learned pieces and rules.',
                'Artifact-specific vocabularies, models, and normalization pipelines can yield different encoding lengths.'
            )),
            question('q4', 'Token ID 42는 모든 모델에서 같은 토큰인가요?', 'Does Token ID 42 mean the same token in every model?', [
                option('a', '예', 'Yes'),
                option('b', '아니요, 특정 artifact의 어휘표에만 의미가 있음', 'No, it only has meaning in one artifact\'s vocabulary'),
            ], 'b', leveled(
                'ID는 선택한 토크나이저의 어휘표 안에서만 뜻이 있습니다.',
                'Token ID는 artifact와 revision에 scoped된 vocabulary index입니다.',
                'An ID only has meaning inside the selected tokenizer\'s vocabulary.',
                'A Token ID is a vocabulary index scoped to an artifact and revision.'
            )),
        ],
        glossaryTermIds: ['token', 'word', 'token-id', 'artifact'],
        narrativeTemplate: leveled(
            '이 입력에는 단어가 {wordCount}개 있지만 토큰은 {tokenCount}개입니다.',
            '입력의 추정 word count는 {wordCount}, 최종 encoding length는 {tokenCount}입니다.',
            'This input has {wordCount} words but {tokenCount} tokens.',
            'The estimated word count is {wordCount}; the final encoding length is {tokenCount}.'
        ),
    },
    {
        schemaVersion: LESSON_SCHEMA_VERSION,
        id: 'korean-emoji-utf8',
        lessonVersion: '1.0.0',
        durationMinutes: 5,
        reviewedAt: LESSON_REVIEWED_AT,
        sourceUrl: 'https://encoding.spec.whatwg.org/#utf-8',
        title: local('한글·emoji와 UTF-8 byte', 'Korean, emoji, and UTF-8 bytes'),
        sample: {
            interactionKind: 'unicode-metrics',
            input: '한글 👩🏽‍💻',
            suggestedAction: 'compare-text-units',
        },
        enginePolicy: {
            realAllowed: true,
            realRequired: false,
            fallbackAllowed: true,
            fallbackDisclosureRequired: true,
            fallbackUse: 'unicode-metrics-only',
        },
        steps: [
            step('goal', '학습 목표', 'Goal', leveled(
                '눈에 보이는 문자 수와 UTF-8 byte 수가 왜 다른지 설명합니다.',
                'UTF-16 code unit, Unicode code point, grapheme cluster, UTF-8 byte를 서로 구분합니다.',
                'Explain why visible character count and UTF-8 byte count differ.',
                'Distinguish UTF-16 code units, Unicode code points, grapheme clusters, and UTF-8 bytes.'
            )),
            step('predict', '결과 예측', 'Predict', leveled(
                '한글 한 글자와 emoji가 각각 UTF-8에서 몇 byte일지 먼저 예상하세요.',
                '결합 emoji가 몇 code point와 grapheme cluster로 측정될지 가설을 세우세요.',
                'First guess how many UTF-8 bytes a Korean syllable and the emoji use.',
                'Hypothesize the code-point and grapheme-cluster counts of the joined emoji.'
            )),
            step('interact', '직접 조작', 'Interact', leveled(
                'emoji의 피부색이나 결합 문자를 지우며 code point와 byte 수 변화를 비교하세요.',
                'NFC/NFD 렌즈를 전환하고 code-point sequence와 UTF-8 length delta를 관찰하세요.',
                'Remove the emoji skin tone or joined character and compare code points with bytes.',
                'Switch between NFC and NFD lenses and observe code-point sequence and UTF-8 length deltas.'
            )),
            step('explain', '규칙 설명', 'Explain', leveled(
                'UTF-8은 문자에 따라 1~4 byte를 쓰며 emoji 하나처럼 보여도 여러 코드 포인트가 합쳐질 수 있습니다.',
                'UTF-8은 scalar value를 가변 길이로 인코딩하고 grapheme boundary는 code-point boundary와 독립적입니다.',
                'UTF-8 uses one to four bytes per scalar value, and one visible emoji may combine several code points.',
                'UTF-8 is a variable-length scalar-value encoding, while grapheme boundaries are independent of code-point boundaries.'
            )),
            step('misconception', '오개념 확인', 'Misconception check', leveled(
                '“화면의 문자 하나는 언제나 1 byte다”라는 주장을 숫자로 반박하세요.',
                'UTF-8 byte length를 JS string.length 또는 grapheme count와 동일시할 수 없는 사례를 찾으세요.',
                'Use the numbers to refute “one visible character is always one byte.”',
                'Find evidence that UTF-8 byte length cannot be equated with JS string.length or grapheme count.'
            )),
            step('summary', '한 줄 요약', 'One-line summary', leveled(
                '보이는 문자, 코드 포인트, UTF-8 byte, 토큰은 서로 다른 단위입니다.',
                'grapheme cluster·code point·UTF-16 code unit·UTF-8 byte·token은 독립된 측정 축입니다.',
                'Visible characters, code points, UTF-8 bytes, and tokens are different units.',
                'Grapheme clusters, code points, UTF-16 code units, UTF-8 bytes, and tokens are independent measures.'
            )),
        ],
        quiz: [
            question('q1', 'ASCII 문자 A의 UTF-8 길이는?', 'What is the UTF-8 length of ASCII “A”?', [
                option('a', '1 byte', '1 byte'),
                option('b', '2 bytes', '2 bytes'),
                option('c', '항상 4 bytes', 'Always 4 bytes'),
            ], 'a', leveled(
                'ASCII 범위 문자는 UTF-8에서 1 byte입니다.',
                'U+0000~U+007F scalar value는 UTF-8 single-byte sequence로 인코딩됩니다.',
                'ASCII characters use one byte in UTF-8.',
                'Scalar values U+0000 through U+007F use a single-byte UTF-8 sequence.'
            )),
            question('q2', '결합 emoji 하나는 code point 여러 개일 수 있나요?', 'Can one joined emoji contain multiple code points?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'a', leveled(
                '피부색, ZWJ, 다른 기호가 한 emoji처럼 보이는 묶음을 만들 수 있습니다.',
                'extended grapheme cluster는 modifier와 ZWJ sequence 등 여러 code point를 포함할 수 있습니다.',
                'Skin tone, ZWJ, and other symbols can form one visible emoji.',
                'An extended grapheme cluster can include modifiers, ZWJ sequences, and multiple code points.'
            )),
            question('q3', 'NFC와 NFD 텍스트는 겉모양이 같을 수 있나요?', 'Can NFC and NFD text look the same?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'a', leveled(
                '같아 보이는 문자를 조합된 코드 포인트 또는 분해된 시퀀스로 표현할 수 있습니다.',
                'canonically equivalent sequences는 렌더링이 같아도 code-point 및 byte sequence가 다를 수 있습니다.',
                'The same-looking text may use composed or decomposed sequences.',
                'Canonically equivalent sequences can render alike while their code-point and byte sequences differ.'
            )),
            question('q4', 'UTF-8 byte 수와 토큰 수는 항상 같은가요?', 'Are UTF-8 byte count and token count always identical?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'b', leveled(
                '토큰은 어휘와 분할 규칙으로 만들어지므로 byte 수와 일대일 대응하지 않습니다.',
                'byte-level tokenizer도 merge와 special token을 적용할 수 있어 final encoding length는 byte length와 다릅니다.',
                'Tokens come from vocabulary and splitting rules, not a one-to-one byte mapping.',
                'Even byte-level tokenizers can apply merges and special tokens, so final encoding length differs from byte length.'
            )),
        ],
        glossaryTermIds: ['utf8', 'code-point', 'grapheme-cluster', 'normalization', 'token'],
        narrativeTemplate: leveled(
            '이 입력은 화면상 {graphemes}개 문자 묶음, {codePoints}개 코드 포인트, UTF-8 {utf8Bytes} bytes입니다.',
            '측정값은 grapheme cluster {graphemes}, Unicode code point {codePoints}, UTF-8 octet {utf8Bytes}입니다.',
            'This input has {graphemes} visible character groups, {codePoints} code points, and {utf8Bytes} UTF-8 bytes.',
            'Measured units: {graphemes} grapheme clusters, {codePoints} Unicode code points, and {utf8Bytes} UTF-8 octets.'
        ),
    },
    {
        schemaVersion: LESSON_SCHEMA_VERSION,
        id: 'same-text-different-tokenizers',
        lessonVersion: '1.0.0',
        durationMinutes: 5,
        reviewedAt: LESSON_REVIEWED_AT,
        sourceUrl: 'https://huggingface.co/docs/transformers/main/en/tokenizer_summary',
        title: local('같은 뜻도 tokenizer마다 다르다', 'The same meaning varies by tokenizer'),
        sample: {
            interactionKind: 'artifact-comparison',
            input: 'Hello, tokenizer! 안녕하세요.',
            suggestedAction: 'compare-two-real-artifacts',
        },
        enginePolicy: {
            realAllowed: true,
            realRequired: true,
            fallbackAllowed: false,
            fallbackDisclosureRequired: true,
            fallbackUse: 'forbidden-for-comparison',
        },
        steps: [
            step('goal', '학습 목표', 'Goal', leveled(
                '같은 입력도 토크나이저가 바뀌면 경계와 개수가 달라질 수 있음을 설명합니다.',
                'artifact revision별 vocabulary와 segmentation pipeline이 encoding에 미치는 영향을 설명합니다.',
                'Explain why the same input can have different boundaries and counts under different tokenizers.',
                'Explain how artifact-specific vocabularies and segmentation pipelines affect an encoding.'
            )),
            step('predict', '결과 예측', 'Predict', leveled(
                '두 토크나이저 중 한글 구간을 더 적은 토큰으로 나눌 쪽을 예상하세요.',
                '각 artifact의 학습 말뭉치와 vocabulary coverage를 근거로 token-count delta의 방향을 예측하세요.',
                'Guess which tokenizer will use fewer tokens for the Korean segment.',
                'Predict the token-count delta from likely corpus and vocabulary coverage differences.'
            )),
            step('interact', '직접 조작', 'Interact', leveled(
                '같은 입력을 실제 토크나이저 두 개로 분석하고 달라진 경계만 찾아보세요.',
                '동일 옵션과 pinned revision으로 두 AnalysisResult의 IDs와 display tokens를 비교하세요.',
                'Analyze the same input with two real tokenizers and find only the changed boundaries.',
                'Compare IDs and display tokens from two AnalysisResults under identical options and pinned revisions.'
            )),
            step('explain', '규칙 설명', 'Explain', leveled(
                '토크나이저마다 배운 어휘 조각과 합치는 규칙이 다르기 때문에 결과도 달라집니다.',
                'vocabulary frequency, subword algorithm, normalizer, post-processor가 artifact별 encoding 차이를 만듭니다.',
                'Tokenizers learn different pieces and merge rules, so their results differ.',
                'Artifact-specific vocabulary frequencies, subword algorithms, normalizers, and post-processors produce different encodings.'
            )),
            step('misconception', '오개념 확인', 'Misconception check', leveled(
                '“토큰 수가 적은 토크나이저가 언제나 더 좋은 모델이다”가 왜 성립하지 않는지 말해보세요.',
                'encoding efficiency만으로 model quality, latency, context policy를 추론할 수 없음을 확인하세요.',
                'Explain why “the tokenizer with fewer tokens always belongs to the better model” is false.',
                'Confirm that encoding efficiency alone does not determine model quality, latency, or context policy.'
            )),
            step('summary', '한 줄 요약', 'One-line summary', leveled(
                '토큰 결과는 문장만이 아니라 선택한 토크나이저에도 달려 있습니다.',
                '재현 가능한 encoding은 입력·옵션·artifact revision을 함께 고정해야 합니다.',
                'Tokenization depends on both the text and the selected tokenizer.',
                'A reproducible encoding must pin the input, options, and artifact revision together.'
            )),
        ],
        quiz: [
            question('q1', '같은 문자열이면 Token ID도 모든 토크나이저에서 같나요?', 'Does the same string get identical Token IDs in every tokenizer?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'b', leveled(
                '각 토크나이저의 어휘표 번호 체계가 다릅니다.',
                'Token IDs are artifact-scoped vocabulary indices.',
                'Each tokenizer has its own vocabulary numbering.',
                'Token IDs are artifact-scoped vocabulary indices.'
            )),
            question('q2', '공정한 A/B 비교에 필요한 것은?', 'What is needed for a fair A/B comparison?', [
                option('a', '서로 다른 입력과 옵션', 'Different inputs and options'),
                option('b', '같은 입력·옵션과 고정된 artifact revision', 'The same input and options with pinned artifact revisions'),
                option('c', '토크나이저 이름만 기록', 'Only the tokenizer names'),
            ], 'b', leveled(
                '입력과 옵션을 같게 두어야 토크나이저 차이만 볼 수 있습니다.',
                'controlled comparison은 request와 options를 동일하게 유지하고 artifact revision을 provenance로 고정합니다.',
                'Keep input and options equal to isolate tokenizer differences.',
                'A controlled comparison holds the request and options constant and pins artifact revisions as provenance.'
            )),
            question('q3', '토큰 수가 더 적으면 모델 품질도 반드시 더 좋은가요?', 'Does a lower token count guarantee better model quality?', [
                option('a', '예', 'Yes'),
                option('b', '아니요', 'No'),
            ], 'b', leveled(
                '토큰 효율과 모델 품질은 서로 다른 지표입니다.',
                'encoding length는 vocabulary efficiency 지표이고 downstream model quality의 충분조건이 아닙니다.',
                'Token efficiency is a separate measure and does not determine model quality.',
                'Encoding length measures vocabulary efficiency and is not sufficient evidence of downstream model quality.'
            )),
            question('q4', '휴리스틱 폴백 두 개로 정확한 artifact 차이를 결론 내릴 수 있나요?', 'Can two heuristic fallbacks establish an exact artifact difference?', [
                option('a', '예', 'Yes'),
                option('b', '아니요, 실제 artifact 결과가 필요함', 'No, real artifact results are required'),
            ], 'b', leveled(
                '폴백은 실제 토크나이저의 어휘와 ID를 재현하지 않습니다.',
                'heuristic output lacks artifact-authoritative evidence, so this lesson forbids it for comparison claims.',
                'A fallback does not reproduce a real tokenizer\'s vocabulary or IDs.',
                'Heuristic output lacks artifact-authoritative evidence, so this lesson forbids it for comparison claims.'
            )),
        ],
        glossaryTermIds: ['token', 'token-id', 'artifact', 'normalization'],
        narrativeTemplate: leveled(
            '{artifactA}는 {tokenCountA} tokens, {artifactB}는 {tokenCountB} tokens로 차이는 {delta}입니다.',
            '동일 request에서 {artifactA} encoding length={tokenCountA}, {artifactB} encoding length={tokenCountB}, delta={delta}입니다.',
            '{artifactA} uses {tokenCountA} tokens and {artifactB} uses {tokenCountB}, a delta of {delta}.',
            'For the same request: {artifactA} encoding length={tokenCountA}, {artifactB} encoding length={tokenCountB}, delta={delta}.'
        ),
    },
];

export const LESSON_GLOSSARY = deepFreeze(glossary);
export const LESSONS = deepFreeze(lessons);

const lessonById = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
const glossaryById = new Map(LESSON_GLOSSARY.map((entry) => [entry.id, entry]));

function requireChoice(value, allowed, label) {
    if (!allowed.includes(value)) {
        throw new RangeError(`${label} must be one of: ${allowed.join(', ')}`);
    }
    return value;
}

function requireLesson(lessonOrId) {
    const lesson = typeof lessonOrId === 'string' ? lessonById.get(lessonOrId) : lessonOrId;
    if (!lesson || typeof lesson !== 'object' || !lessonById.has(lesson.id)) {
        throw new RangeError(`Unknown lesson: ${String(lessonOrId)}`);
    }
    return lesson;
}

function selectLevel(copy, locale, level) {
    return copy[level][locale];
}

/** Return a UI-ready, detached projection in one locale and explanation level. */
export function selectLesson(lessonOrId, { locale = 'ko', level = 'beginner' } = {}) {
    const lesson = requireLesson(lessonOrId);
    requireChoice(locale, LESSON_LOCALES, 'locale');
    requireChoice(level, LESSON_LEVELS, 'level');

    return {
        schemaVersion: lesson.schemaVersion,
        id: lesson.id,
        lessonVersion: lesson.lessonVersion,
        durationMinutes: lesson.durationMinutes,
        reviewedAt: lesson.reviewedAt,
        sourceUrl: lesson.sourceUrl,
        title: lesson.title[locale],
        sample: { ...lesson.sample },
        enginePolicy: { ...lesson.enginePolicy },
        steps: lesson.steps.map((entry) => ({
            id: entry.id,
            heading: entry.heading[locale],
            copy: selectLevel(entry.copy, locale, level),
        })),
        quiz: lesson.quiz.map((entry) => ({
            id: entry.id,
            prompt: entry.prompt[locale],
            options: entry.options.map((candidate) => ({
                id: candidate.id,
                label: candidate.label[locale],
            })),
            correctOptionId: entry.correctOptionId,
            explanation: selectLevel(entry.explanation, locale, level),
        })),
        glossary: lesson.glossaryTermIds.map((id) => {
            const entry = glossaryById.get(id);
            return {
                id,
                term: entry.term[locale],
                definition: selectLevel(entry.definition, locale, level),
                sourceUrl: entry.sourceUrl,
            };
        }),
        narrativeTemplate: selectLevel(lesson.narrativeTemplate, locale, level),
    };
}

/** Fill a lesson's localized narrative template without reading global UI state. */
export function formatLessonNarrative(lessonOrId, values, options = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('values must be an object');
    }
    const { narrativeTemplate } = selectLesson(lessonOrId, options);
    return narrativeTemplate.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, key) => {
        if (!Object.hasOwn(values, key) || values[key] === null || values[key] === undefined) {
            return placeholder;
        }
        return String(values[key]);
    });
}

export function createLessonProgress(lessonOrId) {
    const lesson = requireLesson(lessonOrId);
    return {
        schemaVersion: LESSON_SCHEMA_VERSION,
        lessonId: lesson.id,
        lessonVersion: lesson.lessonVersion,
        completedStepIds: [],
        answers: {},
    };
}

function requireProgress(progress) {
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
        throw new TypeError('progress must be an object');
    }
    const lesson = requireLesson(progress.lessonId);
    if (progress.schemaVersion !== LESSON_SCHEMA_VERSION || progress.lessonVersion !== lesson.lessonVersion) {
        throw new RangeError('Progress version does not match the lesson');
    }
    if (!Array.isArray(progress.completedStepIds) || !progress.answers || typeof progress.answers !== 'object') {
        throw new TypeError('Progress shape is invalid');
    }
    return lesson;
}

/** Complete exactly the next step, returning a new progress object. */
export function completeLessonStep(progress, stepId) {
    const lesson = requireProgress(progress);
    const completed = progress.completedStepIds;
    const nextId = LESSON_STEP_ORDER[completed.length] ?? null;
    if (completed.includes(stepId)) return { ...progress, completedStepIds: [...completed], answers: { ...progress.answers } };
    if (!lesson.steps.some((entry) => entry.id === stepId)) throw new RangeError(`Unknown lesson step: ${stepId}`);
    if (stepId !== nextId) throw new RangeError(`Complete ${nextId} before ${stepId}`);
    return {
        ...progress,
        completedStepIds: [...completed, stepId],
        answers: { ...progress.answers },
    };
}

/** Record one valid answer without mutating the prior progress object. */
export function answerLessonQuestion(progress, questionId, optionId) {
    const lesson = requireProgress(progress);
    const item = lesson.quiz.find((entry) => entry.id === questionId);
    if (!item) throw new RangeError(`Unknown quiz question: ${questionId}`);
    if (!item.options.some((entry) => entry.id === optionId)) {
        throw new RangeError(`Unknown option for ${questionId}: ${optionId}`);
    }
    return {
        ...progress,
        completedStepIds: [...progress.completedStepIds],
        answers: { ...progress.answers, [questionId]: optionId },
    };
}

export function summarizeLessonProgress(progress) {
    const lesson = requireProgress(progress);
    const completed = new Set(progress.completedStepIds);
    const completedSteps = LESSON_STEP_ORDER.filter((id) => completed.has(id)).length;
    const quiz = scoreLessonQuiz(lesson, progress.answers);
    return {
        completedSteps,
        totalSteps: LESSON_STEP_ORDER.length,
        percent: Math.round((completedSteps / LESSON_STEP_ORDER.length) * 100),
        nextStepId: LESSON_STEP_ORDER.find((id) => !completed.has(id)) ?? null,
        lessonComplete: completedSteps === LESSON_STEP_ORDER.length,
        quiz,
    };
}

/** Score a four-question lesson quiz; three correct answers is the P1 pass threshold. */
export function scoreLessonQuiz(lessonOrId, answers = {}) {
    const lesson = requireLesson(lessonOrId);
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        throw new TypeError('answers must be an object');
    }
    const correctQuestionIds = [];
    const incorrectQuestionIds = [];
    const unansweredQuestionIds = [];

    for (const item of lesson.quiz) {
        if (!Object.hasOwn(answers, item.id)) {
            unansweredQuestionIds.push(item.id);
        } else if (answers[item.id] === item.correctOptionId) {
            correctQuestionIds.push(item.id);
        } else {
            incorrectQuestionIds.push(item.id);
        }
    }

    return {
        total: lesson.quiz.length,
        answered: correctQuestionIds.length + incorrectQuestionIds.length,
        correct: correctQuestionIds.length,
        percent: Math.round((correctQuestionIds.length / lesson.quiz.length) * 100),
        passed: correctQuestionIds.length >= 3,
        correctQuestionIds,
        incorrectQuestionIds,
        unansweredQuestionIds,
    };
}

function collectLocalErrors(value, path, errors) {
    for (const locale of LESSON_LOCALES) {
        if (!value || typeof value[locale] !== 'string' || value[locale].trim() === '') {
            errors.push(`${path}.${locale} must be a non-empty string`);
        }
    }
}

function collectLeveledErrors(value, path, errors) {
    for (const level of LESSON_LEVELS) collectLocalErrors(value?.[level], `${path}.${level}`, errors);
}

/** Validate supplied lesson data without throwing, so editors can show every defect at once. */
export function validateLessonCatalog(catalog = LESSONS, glossaryCatalog = LESSON_GLOSSARY) {
    const errors = [];
    if (!Array.isArray(catalog)) return { valid: false, errors: ['catalog must be an array'] };
    if (!Array.isArray(glossaryCatalog)) return { valid: false, errors: ['glossary must be an array'] };

    const glossaryIds = new Set();
    for (const [index, entry] of glossaryCatalog.entries()) {
        const path = `glossary[${index}]`;
        if (!entry || typeof entry !== 'object') {
            errors.push(`${path} must be an object`);
            continue;
        }
        if (typeof entry.id !== 'string' || entry.id === '') errors.push(`${path}.id must be a string`);
        else if (glossaryIds.has(entry.id)) errors.push(`${path}.id is duplicated: ${entry.id}`);
        else glossaryIds.add(entry.id);
        collectLocalErrors(entry.term, `${path}.term`, errors);
        collectLeveledErrors(entry.definition, `${path}.definition`, errors);
        try {
            if (new URL(entry.sourceUrl).protocol !== 'https:') errors.push(`${path}.sourceUrl must use https`);
        } catch {
            errors.push(`${path}.sourceUrl must be a valid URL`);
        }
    }

    const lessonIds = new Set();
    for (const [index, lesson] of catalog.entries()) {
        const path = `lessons[${index}]`;
        if (!lesson || typeof lesson !== 'object') {
            errors.push(`${path} must be an object`);
            continue;
        }
        if (lesson.schemaVersion !== LESSON_SCHEMA_VERSION) errors.push(`${path}.schemaVersion is unsupported`);
        if (typeof lesson.id !== 'string' || lesson.id === '') errors.push(`${path}.id must be a string`);
        else if (lessonIds.has(lesson.id)) errors.push(`${path}.id is duplicated: ${lesson.id}`);
        else lessonIds.add(lesson.id);
        if (!/^\d+\.\d+\.\d+$/.test(lesson.lessonVersion ?? '')) errors.push(`${path}.lessonVersion must be semver`);
        if (lesson.durationMinutes !== 5) errors.push(`${path}.durationMinutes must be 5`);
        if (lesson.reviewedAt !== LESSON_REVIEWED_AT) errors.push(`${path}.reviewedAt must be ${LESSON_REVIEWED_AT}`);
        try {
            if (new URL(lesson.sourceUrl).protocol !== 'https:') errors.push(`${path}.sourceUrl must use https`);
        } catch {
            errors.push(`${path}.sourceUrl must be a valid URL`);
        }
        collectLocalErrors(lesson.title, `${path}.title`, errors);

        const policy = lesson.enginePolicy;
        for (const field of ['realAllowed', 'realRequired', 'fallbackAllowed', 'fallbackDisclosureRequired']) {
            if (typeof policy?.[field] !== 'boolean') errors.push(`${path}.enginePolicy.${field} must be boolean`);
        }
        if (policy?.realRequired && !policy?.realAllowed) errors.push(`${path}.enginePolicy cannot require a disallowed real engine`);
        if (typeof policy?.fallbackUse !== 'string' || policy.fallbackUse === '') {
            errors.push(`${path}.enginePolicy.fallbackUse must explain fallback use`);
        }

        if (!Array.isArray(lesson.steps)) {
            errors.push(`${path}.steps must be an array`);
        } else {
            const actualOrder = lesson.steps.map((entry) => entry?.id);
            if (actualOrder.join('|') !== LESSON_STEP_ORDER.join('|')) errors.push(`${path}.steps must follow the required order`);
            lesson.steps.forEach((entry, stepIndex) => {
                collectLocalErrors(entry?.heading, `${path}.steps[${stepIndex}].heading`, errors);
                collectLeveledErrors(entry?.copy, `${path}.steps[${stepIndex}].copy`, errors);
            });
        }

        if (!Array.isArray(lesson.quiz) || lesson.quiz.length !== 4) {
            errors.push(`${path}.quiz must contain four questions`);
        } else {
            const questionIds = new Set();
            lesson.quiz.forEach((item, questionIndex) => {
                const questionPath = `${path}.quiz[${questionIndex}]`;
                if (typeof item?.id !== 'string' || questionIds.has(item.id)) errors.push(`${questionPath}.id must be unique`);
                else questionIds.add(item.id);
                collectLocalErrors(item?.prompt, `${questionPath}.prompt`, errors);
                collectLeveledErrors(item?.explanation, `${questionPath}.explanation`, errors);
                if (!Array.isArray(item?.options) || item.options.length < 2) {
                    errors.push(`${questionPath}.options must contain at least two choices`);
                } else {
                    const optionIds = new Set();
                    item.options.forEach((candidate, optionIndex) => {
                        if (typeof candidate?.id !== 'string' || optionIds.has(candidate.id)) {
                            errors.push(`${questionPath}.options[${optionIndex}].id must be unique`);
                        } else optionIds.add(candidate.id);
                        collectLocalErrors(candidate?.label, `${questionPath}.options[${optionIndex}].label`, errors);
                    });
                    if (!optionIds.has(item.correctOptionId)) errors.push(`${questionPath}.correctOptionId must reference an option`);
                }
            });
        }

        if (!Array.isArray(lesson.glossaryTermIds) || lesson.glossaryTermIds.length === 0) {
            errors.push(`${path}.glossaryTermIds must not be empty`);
        } else {
            for (const id of lesson.glossaryTermIds) {
                if (!glossaryIds.has(id)) errors.push(`${path}.glossaryTermIds references unknown term: ${id}`);
            }
        }
        collectLeveledErrors(lesson.narrativeTemplate, `${path}.narrativeTemplate`, errors);
    }

    return { valid: errors.length === 0, errors };
}

export const codingProblems = [
  {
    id: 1,
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    category: 'Arrays & Hashing',
    tags: ['array', 'hash-map'],
    description: `Given an array of integers \`nums\` and an integer \`target\`, return the indices of the two numbers that add up to \`target\`. You may assume that each input has exactly one solution, and you may not use the same element twice.`,
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'nums[0] + nums[1] = 2 + 7 = 9' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]', explanation: 'nums[1] + nums[2] = 2 + 4 = 6' },
    ],
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', 'Only one valid answer exists'],
    approach: [
      { step: 1, title: 'Use a hash map', detail: 'Create a map to store each number and its index as we iterate through the array.' },
      { step: 2, title: 'Check for the complement', detail: 'For each element nums[i], compute complement = target - nums[i] and check if it already exists in the map.' },
      { step: 3, title: 'Return indices', detail: 'If the complement exists, return [map.get(complement), i]. Otherwise, add nums[i] to the map and continue.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) {
      return [map.get(complement), i];
    }
    map.set(nums[i], i);
  }
}`,
    },
  },
  {
    id: 2,
    slug: 'valid-anagram',
    title: 'Valid Anagram',
    difficulty: 'Easy',
    category: 'Arrays & Hashing',
    tags: ['string', 'hash-map', 'sorting'],
    description: `Given two strings \`s\` and \`t\`, return \`true\` if \`t\` is an anagram of \`s\`, and \`false\` otherwise. An anagram is a word formed by rearranging the letters of another word using all original letters exactly once.`,
    examples: [
      { input: 's = "anagram", t = "nagaram"', output: 'true', explanation: 'Both strings contain the same characters with the same frequencies.' },
      { input: 's = "rat", t = "car"', output: 'false', explanation: '"rat" and "car" do not have the same character frequencies.' },
    ],
    constraints: ['1 <= s.length, t.length <= 5 * 10^4', 's and t consist of lowercase English letters'],
    approach: [
      { step: 1, title: 'Check lengths', detail: 'If the two strings have different lengths, they cannot be anagrams — return false immediately.' },
      { step: 2, title: 'Count character frequencies', detail: 'Use a hash map to count each character in s, then decrement counts for each character in t.' },
      { step: 3, title: 'Verify all counts are zero', detail: 'If every count in the map is 0, the strings are anagrams.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1) — at most 26 keys',
    solution: {
      language: 'javascript',
      code: `function isAnagram(s, t) {
  if (s.length !== t.length) return false;
  const count = {};
  for (const c of s) count[c] = (count[c] ?? 0) + 1;
  for (const c of t) {
    if (!count[c]) return false;
    count[c]--;
  }
  return true;
}`,
    },
  },
  {
    id: 3,
    slug: 'contains-duplicate',
    title: 'Contains Duplicate',
    difficulty: 'Easy',
    category: 'Arrays & Hashing',
    tags: ['array', 'hash-set'],
    description: `Given an integer array \`nums\`, return \`true\` if any value appears at least twice in the array, and \`false\` if every element is distinct.`,
    examples: [
      { input: 'nums = [1,2,3,1]', output: 'true', explanation: '1 appears at index 0 and 3.' },
      { input: 'nums = [1,2,3,4]', output: 'false', explanation: 'All elements are distinct.' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '-10^9 <= nums[i] <= 10^9'],
    approach: [
      { step: 1, title: 'Use a Set', detail: 'A Set only stores unique values, so we can use it to track elements seen so far.' },
      { step: 2, title: 'Iterate and check', detail: 'For each number, check if it is already in the set. If yes, return true. Otherwise, add it to the set.' },
      { step: 3, title: 'Return false', detail: 'If we reach the end without finding a duplicate, return false.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `function containsDuplicate(nums) {
  const seen = new Set();
  for (const n of nums) {
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}`,
    },
  },
  {
    id: 4,
    slug: 'group-anagrams',
    title: 'Group Anagrams',
    difficulty: 'Medium',
    category: 'Arrays & Hashing',
    tags: ['string', 'hash-map', 'sorting'],
    description: `Given an array of strings \`strs\`, group the anagrams together. You can return the answer in any order.`,
    examples: [
      { input: 'strs = ["eat","tea","tan","ate","nat","bat"]', output: '[["bat"],["nat","tan"],["ate","eat","tea"]]', explanation: 'Anagrams share the same sorted character sequence.' },
    ],
    constraints: ['1 <= strs.length <= 10^4', '0 <= strs[i].length <= 100', 'strs[i] consists of lowercase English letters'],
    approach: [
      { step: 1, title: 'Create a map keyed by sorted string', detail: 'For each string, sort its characters to produce a canonical key that all anagrams share.' },
      { step: 2, title: 'Group by key', detail: 'Append each original string to the list at its canonical key in the map.' },
      { step: 3, title: 'Return values', detail: 'Return all groups (the map\'s values) as the result.' },
    ],
    timeComplexity: 'O(n * k log k) where k is max string length',
    spaceComplexity: 'O(n * k)',
    solution: {
      language: 'javascript',
      code: `function groupAnagrams(strs) {
  const map = new Map();
  for (const s of strs) {
    const key = s.split('').sort().join('');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.values()];
}`,
    },
  },
  {
    id: 5,
    slug: 'top-k-frequent-elements',
    title: 'Top K Frequent Elements',
    difficulty: 'Medium',
    category: 'Arrays & Hashing',
    tags: ['array', 'hash-map', 'bucket-sort'],
    description: `Given an integer array \`nums\` and an integer \`k\`, return the \`k\` most frequent elements. You may return the answer in any order.`,
    examples: [
      { input: 'nums = [1,1,1,2,2,3], k = 2', output: '[1,2]', explanation: '1 appears 3 times, 2 appears 2 times.' },
    ],
    constraints: ['1 <= nums.length <= 10^5', 'k is in the range [1, the number of unique elements]'],
    approach: [
      { step: 1, title: 'Count frequencies', detail: 'Build a frequency map counting how many times each number appears.' },
      { step: 2, title: 'Bucket sort by frequency', detail: 'Create an array of buckets indexed by frequency. Each bucket holds the numbers with that frequency.' },
      { step: 3, title: 'Collect top k', detail: 'Iterate the buckets from highest to lowest frequency, collecting elements until we have k results.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `function topKFrequent(nums, k) {
  const freq = new Map();
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);

  const buckets = Array.from({ length: nums.length + 1 }, () => []);
  for (const [num, count] of freq) buckets[count].push(num);

  const result = [];
  for (let i = buckets.length - 1; i >= 0 && result.length < k; i--) {
    result.push(...buckets[i]);
  }
  return result.slice(0, k);
}`,
    },
  },
  {
    id: 6,
    slug: 'valid-palindrome',
    title: 'Valid Palindrome',
    difficulty: 'Easy',
    category: 'Two Pointers',
    tags: ['string', 'two-pointers'],
    description: `A phrase is a palindrome if, after converting all uppercase letters to lowercase and removing all non-alphanumeric characters, it reads the same forward and backward. Given a string \`s\`, return \`true\` if it is a palindrome, or \`false\` otherwise.`,
    examples: [
      { input: 's = "A man, a plan, a canal: Panama"', output: 'true', explanation: '"amanaplanacanalpanama" is a palindrome.' },
      { input: 's = "race a car"', output: 'false', explanation: '"raceacar" is not a palindrome.' },
    ],
    constraints: ['1 <= s.length <= 2 * 10^5', 's consists only of printable ASCII characters'],
    approach: [
      { step: 1, title: 'Use two pointers', detail: 'Place one pointer at the start and one at the end of the string.' },
      { step: 2, title: 'Skip non-alphanumeric characters', detail: 'Move each pointer inward, skipping any character that is not a letter or digit.' },
      { step: 3, title: 'Compare characters', detail: 'At each valid position, compare the lowercase characters. If they differ, return false. If the pointers meet, return true.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function isPalindrome(s) {
  let l = 0, r = s.length - 1;
  const isAlnum = c => /[a-z0-9]/.test(c);

  while (l < r) {
    while (l < r && !isAlnum(s[l].toLowerCase())) l++;
    while (l < r && !isAlnum(s[r].toLowerCase())) r--;
    if (s[l].toLowerCase() !== s[r].toLowerCase()) return false;
    l++;
    r--;
  }
  return true;
}`,
    },
  },
  {
    id: 7,
    slug: 'three-sum',
    title: '3Sum',
    difficulty: 'Medium',
    category: 'Two Pointers',
    tags: ['array', 'two-pointers', 'sorting'],
    description: `Given an integer array \`nums\`, return all the triplets \`[nums[i], nums[j], nums[k]]\` such that \`i != j\`, \`i != k\`, \`j != k\`, and \`nums[i] + nums[j] + nums[k] == 0\`. The solution set must not contain duplicate triplets.`,
    examples: [
      { input: 'nums = [-1,0,1,2,-1,-4]', output: '[[-1,-1,2],[-1,0,1]]', explanation: 'The triplets that sum to zero, without duplicates.' },
    ],
    constraints: ['3 <= nums.length <= 3000', '-10^5 <= nums[i] <= 10^5'],
    approach: [
      { step: 1, title: 'Sort the array', detail: 'Sorting enables the two-pointer technique and makes it easy to skip duplicates.' },
      { step: 2, title: 'Fix one element, use two pointers for the rest', detail: 'Iterate i from 0 to n-3. For each i, use left = i+1 and right = n-1 pointers to find pairs that sum to -nums[i].' },
      { step: 3, title: 'Skip duplicates', detail: 'After finding a valid triplet, advance both pointers and skip over any repeated values to avoid duplicate results.' },
    ],
    timeComplexity: 'O(n²)',
    spaceComplexity: 'O(1) excluding output',
    solution: {
      language: 'javascript',
      code: `function threeSum(nums) {
  nums.sort((a, b) => a - b);
  const result = [];

  for (let i = 0; i < nums.length - 2; i++) {
    if (i > 0 && nums[i] === nums[i - 1]) continue;
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const sum = nums[i] + nums[l] + nums[r];
      if (sum === 0) {
        result.push([nums[i], nums[l], nums[r]]);
        while (l < r && nums[l] === nums[l + 1]) l++;
        while (l < r && nums[r] === nums[r - 1]) r--;
        l++; r--;
      } else if (sum < 0) {
        l++;
      } else {
        r--;
      }
    }
  }
  return result;
}`,
    },
  },
  {
    id: 8,
    slug: 'container-with-most-water',
    title: 'Container With Most Water',
    difficulty: 'Medium',
    category: 'Two Pointers',
    tags: ['array', 'two-pointers', 'greedy'],
    description: `You are given an integer array \`height\` of length \`n\`. There are \`n\` vertical lines drawn such that the two endpoints of the \`i\`th line are \`(i, 0)\` and \`(i, height[i])\`. Find two lines that together with the x-axis form a container that holds the most water. Return the maximum amount of water a container can store.`,
    examples: [
      { input: 'height = [1,8,6,2,5,4,8,3,7]', output: '49', explanation: 'Lines at index 1 (height 8) and index 8 (height 7) with width 7 gives area = 7 * 7 = 49.' },
    ],
    constraints: ['n == height.length', '2 <= n <= 10^5', '0 <= height[i] <= 10^4'],
    approach: [
      { step: 1, title: 'Start with widest container', detail: 'Place left pointer at 0 and right pointer at n-1. This is the widest possible container.' },
      { step: 2, title: 'Compute area', detail: 'Area = min(height[l], height[r]) * (r - l). Track the maximum seen so far.' },
      { step: 3, title: 'Move the shorter side inward', detail: 'Moving the taller side can only decrease width without increasing height. Moving the shorter side might find a taller line, potentially increasing area.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function maxArea(height) {
  let l = 0, r = height.length - 1;
  let max = 0;
  while (l < r) {
    max = Math.max(max, Math.min(height[l], height[r]) * (r - l));
    if (height[l] < height[r]) l++;
    else r--;
  }
  return max;
}`,
    },
  },
  {
    id: 9,
    slug: 'best-time-to-buy-sell-stock',
    title: 'Best Time to Buy and Sell Stock',
    difficulty: 'Easy',
    category: 'Sliding Window',
    tags: ['array', 'greedy'],
    description: `You are given an array \`prices\` where \`prices[i]\` is the price of a stock on the \`i\`th day. You want to maximize your profit by choosing a single day to buy and a different day in the future to sell. Return the maximum profit you can achieve from this transaction. If you cannot achieve any profit, return \`0\`.`,
    examples: [
      { input: 'prices = [7,1,5,3,6,4]', output: '5', explanation: 'Buy on day 2 (price=1) and sell on day 5 (price=6), profit = 6-1 = 5.' },
    ],
    constraints: ['1 <= prices.length <= 10^5', '0 <= prices[i] <= 10^4'],
    approach: [
      { step: 1, title: 'Track the minimum price seen so far', detail: 'Keep a running minimum as you scan left to right. This represents the cheapest day to have bought.' },
      { step: 2, title: 'Compute profit at each day', detail: 'For each day, compute price - minPrice. This is the best profit if you sell today.' },
      { step: 3, title: 'Track maximum profit', detail: 'Update the global maximum profit whenever a higher profit is found.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function maxProfit(prices) {
  let minPrice = Infinity;
  let maxProfit = 0;
  for (const price of prices) {
    minPrice = Math.min(minPrice, price);
    maxProfit = Math.max(maxProfit, price - minPrice);
  }
  return maxProfit;
}`,
    },
  },
  {
    id: 10,
    slug: 'longest-substring-without-repeating',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    category: 'Sliding Window',
    tags: ['string', 'sliding-window', 'hash-map'],
    description: `Given a string \`s\`, find the length of the longest substring without repeating characters.`,
    examples: [
      { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc", with length 3.' },
      { input: 's = "bbbbb"', output: '1', explanation: 'The answer is "b", with length 1.' },
    ],
    constraints: ['0 <= s.length <= 5 * 10^4', 's consists of English letters, digits, symbols and spaces'],
    approach: [
      { step: 1, title: 'Sliding window with a Set', detail: 'Use a Set to store characters in the current window (defined by left and right pointers).' },
      { step: 2, title: 'Expand right pointer', detail: 'Move the right pointer one step at a time. If the character is not in the Set, add it and update the max length.' },
      { step: 3, title: 'Shrink left when duplicate found', detail: 'If a duplicate is found, remove characters from the left of the window until the duplicate is gone, then add the new character.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(min(n, 128)) — bounded by character set',
    solution: {
      language: 'javascript',
      code: `function lengthOfLongestSubstring(s) {
  const seen = new Map();
  let left = 0, max = 0;
  for (let right = 0; right < s.length; right++) {
    const c = s[right];
    if (seen.has(c) && seen.get(c) >= left) {
      left = seen.get(c) + 1;
    }
    seen.set(c, right);
    max = Math.max(max, right - left + 1);
  }
  return max;
}`,
    },
  },
  {
    id: 11,
    slug: 'sliding-window-maximum',
    title: 'Sliding Window Maximum',
    difficulty: 'Hard',
    category: 'Sliding Window',
    tags: ['array', 'sliding-window', 'deque', 'monotonic-queue'],
    description: `Given an array of integers \`nums\` and a sliding window of size \`k\`, the window moves from left to right one position at a time. Return the maximum value in each window position.`,
    examples: [
      { input: 'nums = [1,3,-1,-3,5,3,6,7], k = 3', output: '[3,3,5,5,6,7]', explanation: 'Each window of size 3 yields its maximum value.' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4', '1 <= k <= nums.length'],
    approach: [
      { step: 1, title: 'Use a monotonic deque', detail: 'Maintain a deque of indices such that the corresponding values are in decreasing order. The front always holds the index of the current window\'s maximum.' },
      { step: 2, title: 'Remove out-of-window indices', detail: 'When the front index is outside the current window (i - deque.front >= k), remove it.' },
      { step: 3, title: 'Remove smaller elements from back', detail: 'Before adding a new index, pop all indices from the back whose values are less than or equal to the current element — they can never be a future maximum.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(k)',
    solution: {
      language: 'javascript',
      code: `function maxSlidingWindow(nums, k) {
  const deque = []; // stores indices
  const result = [];

  for (let i = 0; i < nums.length; i++) {
    // remove out-of-window index
    if (deque.length && deque[0] < i - k + 1) deque.shift();

    // remove indices with smaller values from back
    while (deque.length && nums[deque[deque.length - 1]] < nums[i]) {
      deque.pop();
    }

    deque.push(i);

    if (i >= k - 1) result.push(nums[deque[0]]);
  }
  return result;
}`,
    },
  },
  {
    id: 12,
    slug: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    category: 'Stack',
    tags: ['string', 'stack'],
    description: `Given a string \`s\` containing just the characters \`(\`, \`)\`, \`{\`, \`}\`, \`[\`, and \`]\`, determine if the input string is valid. An input string is valid if open brackets are closed by the same type of bracket in the correct order.`,
    examples: [
      { input: 's = "()"', output: 'true', explanation: 'Simple matching pair.' },
      { input: 's = "()[]{}"', output: 'true', explanation: 'All three types of brackets properly closed.' },
      { input: 's = "(]"', output: 'false', explanation: 'Mismatched bracket types.' },
    ],
    constraints: ['1 <= s.length <= 10^4', 's consists of parentheses only'],
    approach: [
      { step: 1, title: 'Use a stack', detail: 'Push open brackets onto the stack. When a closing bracket is encountered, check if the top of the stack is the matching open bracket.' },
      { step: 2, title: 'Match closing brackets', detail: 'If the stack is empty or the top doesn\'t match the current closing bracket, return false.' },
      { step: 3, title: 'Check stack is empty', detail: 'At the end, return true only if the stack is empty (all brackets were matched).' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `function isValid(s) {
  const stack = [];
  const pairs = { ')': '(', '}': '{', ']': '[' };
  for (const c of s) {
    if ('({['.includes(c)) {
      stack.push(c);
    } else {
      if (stack.pop() !== pairs[c]) return false;
    }
  }
  return stack.length === 0;
}`,
    },
  },
  {
    id: 13,
    slug: 'min-stack',
    title: 'Min Stack',
    difficulty: 'Medium',
    category: 'Stack',
    tags: ['stack', 'design'],
    description: `Design a stack that supports push, pop, top, and retrieving the minimum element in constant time. Implement the \`MinStack\` class with methods: \`push(val)\`, \`pop()\`, \`top()\`, and \`getMin()\`.`,
    examples: [
      { input: 'MinStack(), push(-2), push(0), push(-3), getMin(), pop(), top(), getMin()', output: '[-3, 0, -2]', explanation: 'getMin returns -3, then after pop, top is 0 and getMin is -2.' },
    ],
    constraints: ['-2^31 <= val <= 2^31 - 1', 'pop, top, getMin called on non-empty stack'],
    approach: [
      { step: 1, title: 'Use two stacks', detail: 'Maintain the main stack and a separate "min stack" that tracks the minimum at each push level.' },
      { step: 2, title: 'Push to both stacks', detail: 'When pushing, push to the main stack. Push to the min stack only the new minimum (min of current value and current min stack top).' },
      { step: 3, title: 'Pop from both', detail: 'Pop from both stacks simultaneously to keep them in sync.' },
    ],
    timeComplexity: 'O(1) for all operations',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `class MinStack {
  constructor() {
    this.stack = [];
    this.minStack = [];
  }

  push(val) {
    this.stack.push(val);
    const currentMin = this.minStack.length
      ? Math.min(val, this.minStack[this.minStack.length - 1])
      : val;
    this.minStack.push(currentMin);
  }

  pop() {
    this.stack.pop();
    this.minStack.pop();
  }

  top() {
    return this.stack[this.stack.length - 1];
  }

  getMin() {
    return this.minStack[this.minStack.length - 1];
  }
}`,
    },
  },
  {
    id: 14,
    slug: 'binary-search',
    title: 'Binary Search',
    difficulty: 'Easy',
    category: 'Binary Search',
    tags: ['array', 'binary-search'],
    description: `Given an array of integers \`nums\` sorted in ascending order and an integer \`target\`, write a function to search for \`target\` in \`nums\`. If \`target\` exists, return its index. Otherwise, return \`-1\`.`,
    examples: [
      { input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4', explanation: '9 exists in nums and its index is 4.' },
      { input: 'nums = [-1,0,3,5,9,12], target = 2', output: '-1', explanation: '2 does not exist in nums.' },
    ],
    constraints: ['1 <= nums.length <= 10^4', 'All nums are unique', 'nums is sorted in ascending order'],
    approach: [
      { step: 1, title: 'Set left and right bounds', detail: 'Initialize left = 0 and right = nums.length - 1.' },
      { step: 2, title: 'Compute mid and compare', detail: 'Compute mid = Math.floor((left + right) / 2). If nums[mid] === target, return mid.' },
      { step: 3, title: 'Narrow the search space', detail: 'If target < nums[mid], search the left half (right = mid - 1). Otherwise, search the right half (left = mid + 1). Repeat until left > right.' },
    ],
    timeComplexity: 'O(log n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function search(nums, target) {
  let left = 0, right = nums.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}`,
    },
  },
  {
    id: 15,
    slug: 'find-minimum-in-rotated-sorted-array',
    title: 'Find Minimum in Rotated Sorted Array',
    difficulty: 'Medium',
    category: 'Binary Search',
    tags: ['array', 'binary-search'],
    description: `Suppose an array sorted in ascending order is rotated at some pivot. Given the rotated array \`nums\` of unique elements, return the minimum element.`,
    examples: [
      { input: 'nums = [3,4,5,1,2]', output: '1', explanation: 'The original array was [1,2,3,4,5], rotated at index 3.' },
      { input: 'nums = [4,5,6,7,0,1,2]', output: '0', explanation: 'The original array was [0,1,2,4,5,6,7], rotated at index 4.' },
    ],
    constraints: ['n == nums.length', '1 <= n <= 5000', 'All values are unique'],
    approach: [
      { step: 1, title: 'Identify which half is sorted', detail: 'If nums[mid] >= nums[left], the left half is sorted and the minimum is in the right half.' },
      { step: 2, title: 'Binary search on the unsorted half', detail: 'Move left to mid + 1 if the left half is sorted (minimum must be in right half). Otherwise, move right to mid.' },
      { step: 3, title: 'Track the result', detail: 'Track the minimum of nums[mid] throughout the loop. When left > right, the answer is found.' },
    ],
    timeComplexity: 'O(log n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function findMin(nums) {
  let left = 0, right = nums.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (nums[mid] > nums[right]) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return nums[left];
}`,
    },
  },
  {
    id: 16,
    slug: 'search-in-rotated-sorted-array',
    title: 'Search in Rotated Sorted Array',
    difficulty: 'Medium',
    category: 'Binary Search',
    tags: ['array', 'binary-search'],
    description: `Given a rotated sorted array \`nums\` with unique values and a target integer, return the index of \`target\` if found, otherwise return \`-1\`. Must run in O(log n) time.`,
    examples: [
      { input: 'nums = [4,5,6,7,0,1,2], target = 0', output: '4', explanation: '0 is at index 4 after rotation.' },
      { input: 'nums = [4,5,6,7,0,1,2], target = 3', output: '-1', explanation: '3 is not in the array.' },
    ],
    constraints: ['1 <= nums.length <= 5000', 'All values are unique'],
    approach: [
      { step: 1, title: 'Determine which side is sorted', detail: 'At each step, compare nums[mid] with nums[left]. If nums[left] <= nums[mid], the left half is sorted.' },
      { step: 2, title: 'Check if target is in the sorted half', detail: 'If the left half is sorted and target is in [nums[left], nums[mid]], search left. Otherwise search right. Mirror logic for right half.' },
      { step: 3, title: 'Standard binary search movement', detail: 'Narrow left or right accordingly until found or left > right.' },
    ],
    timeComplexity: 'O(log n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function search(nums, target) {
  let left = 0, right = nums.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (nums[mid] === target) return mid;

    if (nums[left] <= nums[mid]) {
      // left half is sorted
      if (target >= nums[left] && target < nums[mid]) right = mid - 1;
      else left = mid + 1;
    } else {
      // right half is sorted
      if (target > nums[mid] && target <= nums[right]) left = mid + 1;
      else right = mid - 1;
    }
  }
  return -1;
}`,
    },
  },
  {
    id: 17,
    slug: 'reverse-linked-list',
    title: 'Reverse Linked List',
    difficulty: 'Easy',
    category: 'Linked List',
    tags: ['linked-list', 'iterative', 'recursive'],
    description: `Given the head of a singly linked list, reverse the list and return the reversed list's head.`,
    examples: [
      { input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]', explanation: 'The list is reversed in place.' },
    ],
    constraints: ['Number of nodes is in [0, 5000]', '-5000 <= Node.val <= 5000'],
    approach: [
      { step: 1, title: 'Initialize two pointers', detail: 'Set prev = null and curr = head.' },
      { step: 2, title: 'Iterate and reverse pointers', detail: 'At each step, save curr.next, point curr.next to prev, advance prev to curr, and advance curr to the saved next.' },
      { step: 3, title: 'Return prev', detail: 'When curr is null, prev is the new head of the reversed list.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function reverseList(head) {
  let prev = null, curr = head;
  while (curr) {
    const next = curr.next;
    curr.next = prev;
    prev = curr;
    curr = next;
  }
  return prev;
}`,
    },
  },
  {
    id: 18,
    slug: 'merge-two-sorted-lists',
    title: 'Merge Two Sorted Lists',
    difficulty: 'Easy',
    category: 'Linked List',
    tags: ['linked-list', 'recursion'],
    description: `You are given the heads of two sorted linked lists \`list1\` and \`list2\`. Merge the two lists into one sorted list and return its head.`,
    examples: [
      { input: 'list1 = [1,2,4], list2 = [1,3,4]', output: '[1,1,2,3,4,4]', explanation: 'Merged and sorted result.' },
    ],
    constraints: ['Number of nodes in each list is in [0, 50]', '-100 <= Node.val <= 100'],
    approach: [
      { step: 1, title: 'Use a dummy head node', detail: 'A dummy node simplifies edge cases by giving us a stable starting point for the merged list.' },
      { step: 2, title: 'Compare and advance', detail: 'Compare the current nodes of both lists. Append the smaller one to the merged list and advance that pointer.' },
      { step: 3, title: 'Attach the remaining list', detail: 'When one list is exhausted, attach the remainder of the other list directly.' },
    ],
    timeComplexity: 'O(n + m)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function mergeTwoLists(list1, list2) {
  const dummy = { next: null };
  let curr = dummy;
  while (list1 && list2) {
    if (list1.val <= list2.val) {
      curr.next = list1;
      list1 = list1.next;
    } else {
      curr.next = list2;
      list2 = list2.next;
    }
    curr = curr.next;
  }
  curr.next = list1 ?? list2;
  return dummy.next;
}`,
    },
  },
  {
    id: 19,
    slug: 'linked-list-cycle',
    title: 'Linked List Cycle Detection',
    difficulty: 'Easy',
    category: 'Linked List',
    tags: ['linked-list', 'two-pointers', 'floyd'],
    description: `Given the head of a linked list, determine if the linked list has a cycle. A cycle exists if there is some node in the list that can be reached again by continuously following the \`next\` pointer.`,
    examples: [
      { input: 'head = [3,2,0,-4], pos = 1', output: 'true', explanation: 'The tail connects back to index 1, forming a cycle.' },
    ],
    constraints: ['Number of nodes in [0, 10^4]', '-10^5 <= Node.val <= 10^5'],
    approach: [
      { step: 1, title: 'Floyd\'s cycle detection (fast and slow pointers)', detail: 'Use a slow pointer (moves 1 step) and a fast pointer (moves 2 steps).' },
      { step: 2, title: 'Detect meeting point', detail: 'If there is a cycle, the fast pointer will eventually lap the slow pointer and they will meet inside the cycle.' },
      { step: 3, title: 'No meeting = no cycle', detail: 'If the fast pointer reaches null, there is no cycle.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function hasCycle(head) {
  let slow = head, fast = head;
  while (fast && fast.next) {
    slow = slow.next;
    fast = fast.next.next;
    if (slow === fast) return true;
  }
  return false;
}`,
    },
  },
  {
    id: 20,
    slug: 'reorder-list',
    title: 'Reorder List',
    difficulty: 'Medium',
    category: 'Linked List',
    tags: ['linked-list', 'two-pointers'],
    description: `Given the head of a singly linked list L: L0 → L1 → … → Ln-1 → Ln, reorder it to: L0 → Ln → L1 → Ln-1 → L2 → Ln-2 → … You may not modify the values — only the node pointers.`,
    examples: [
      { input: 'head = [1,2,3,4,5]', output: '[1,5,2,4,3]', explanation: 'Nodes are interleaved from front and back.' },
    ],
    constraints: ['Number of nodes in [1, 5 * 10^4]', '1 <= Node.val <= 1000'],
    approach: [
      { step: 1, title: 'Find the middle with slow/fast pointers', detail: 'Use Floyd\'s algorithm to find the midpoint so you can split the list into two halves.' },
      { step: 2, title: 'Reverse the second half', detail: 'Reverse the second half of the list in place.' },
      { step: 3, title: 'Merge the two halves', detail: 'Interleave nodes from the first half and the reversed second half.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function reorderList(head) {
  // Step 1: find middle
  let slow = head, fast = head;
  while (fast.next && fast.next.next) {
    slow = slow.next;
    fast = fast.next.next;
  }

  // Step 2: reverse second half
  let prev = null, curr = slow.next;
  slow.next = null;
  while (curr) {
    const next = curr.next;
    curr.next = prev;
    prev = curr;
    curr = next;
  }

  // Step 3: merge
  let first = head, second = prev;
  while (second) {
    const tmp1 = first.next, tmp2 = second.next;
    first.next = second;
    second.next = tmp1;
    first = tmp1;
    second = tmp2;
  }
}`,
    },
  },
  {
    id: 21,
    slug: 'invert-binary-tree',
    title: 'Invert Binary Tree',
    difficulty: 'Easy',
    category: 'Trees',
    tags: ['tree', 'recursion', 'bfs'],
    description: `Given the root of a binary tree, invert the tree (mirror it), and return its root.`,
    examples: [
      { input: 'root = [4,2,7,1,3,6,9]', output: '[4,7,2,9,6,3,1]', explanation: 'Every left and right subtree is swapped recursively.' },
    ],
    constraints: ['Number of nodes in [0, 100]', '-100 <= Node.val <= 100'],
    approach: [
      { step: 1, title: 'Base case', detail: 'If root is null, return null.' },
      { step: 2, title: 'Swap left and right children', detail: 'Swap root.left and root.right.' },
      { step: 3, title: 'Recurse on both subtrees', detail: 'Recursively invert root.left and root.right.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(h) — h is tree height (call stack)',
    solution: {
      language: 'javascript',
      code: `function invertTree(root) {
  if (!root) return null;
  [root.left, root.right] = [root.right, root.left];
  invertTree(root.left);
  invertTree(root.right);
  return root;
}`,
    },
  },
  {
    id: 22,
    slug: 'maximum-depth-binary-tree',
    title: 'Maximum Depth of Binary Tree',
    difficulty: 'Easy',
    category: 'Trees',
    tags: ['tree', 'recursion', 'dfs'],
    description: `Given the root of a binary tree, return its maximum depth — the number of nodes along the longest path from the root down to the farthest leaf node.`,
    examples: [
      { input: 'root = [3,9,20,null,null,15,7]', output: '3', explanation: 'The longest path is 3 → 20 → 15 (or 3 → 20 → 7).' },
    ],
    constraints: ['Number of nodes in [0, 10^4]', '-100 <= Node.val <= 100'],
    approach: [
      { step: 1, title: 'Base case', detail: 'If root is null, return 0.' },
      { step: 2, title: 'Recursively compute depths', detail: 'Compute the max depth of the left and right subtrees.' },
      { step: 3, title: 'Return 1 + max of depths', detail: 'The depth of the current node is 1 plus the greater of the two subtree depths.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(h)',
    solution: {
      language: 'javascript',
      code: `function maxDepth(root) {
  if (!root) return 0;
  return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
}`,
    },
  },
  {
    id: 23,
    slug: 'lowest-common-ancestor-bst',
    title: 'Lowest Common Ancestor of a BST',
    difficulty: 'Medium',
    category: 'Trees',
    tags: ['tree', 'bst', 'recursion'],
    description: `Given a binary search tree (BST) and two nodes \`p\` and \`q\`, find their lowest common ancestor (LCA). The LCA is the deepest node that has both p and q as descendants.`,
    examples: [
      { input: 'root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 8', output: '6', explanation: '6 is the LCA of 2 and 8.' },
      { input: 'root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 4', output: '2', explanation: 'A node can be a descendant of itself.' },
    ],
    constraints: ['All Node.val values are unique', 'p and q exist in the BST'],
    approach: [
      { step: 1, title: 'Use BST property', detail: 'If both p and q values are less than root.val, the LCA is in the left subtree.' },
      { step: 2, title: 'Search right subtree', detail: 'If both values are greater than root.val, recurse right.' },
      { step: 3, title: 'Current node is LCA', detail: 'If p and q split across the root (one on each side, or one equals root), the current node is the LCA.' },
    ],
    timeComplexity: 'O(h) — h is tree height',
    spaceComplexity: 'O(1) iterative',
    solution: {
      language: 'javascript',
      code: `function lowestCommonAncestor(root, p, q) {
  let curr = root;
  while (curr) {
    if (p.val < curr.val && q.val < curr.val) {
      curr = curr.left;
    } else if (p.val > curr.val && q.val > curr.val) {
      curr = curr.right;
    } else {
      return curr;
    }
  }
}`,
    },
  },
  {
    id: 24,
    slug: 'binary-tree-level-order-traversal',
    title: 'Binary Tree Level Order Traversal',
    difficulty: 'Medium',
    category: 'Trees',
    tags: ['tree', 'bfs', 'queue'],
    description: `Given the root of a binary tree, return the level order traversal of its nodes' values (i.e., from left to right, level by level).`,
    examples: [
      { input: 'root = [3,9,20,null,null,15,7]', output: '[[3],[9,20],[15,7]]', explanation: 'Three levels of the tree.' },
    ],
    constraints: ['Number of nodes in [0, 2000]', '-1000 <= Node.val <= 1000'],
    approach: [
      { step: 1, title: 'Use a queue for BFS', detail: 'Enqueue the root. Process nodes level by level using a queue.' },
      { step: 2, title: 'Process one level at a time', detail: 'At the start of each iteration, record the current queue size — this is the number of nodes in the current level.' },
      { step: 3, title: 'Build level arrays', detail: 'Dequeue exactly that many nodes, collect their values, and enqueue their children for the next level.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    solution: {
      language: 'javascript',
      code: `function levelOrder(root) {
  if (!root) return [];
  const result = [];
  const queue = [root];
  while (queue.length) {
    const levelSize = queue.length;
    const level = [];
    for (let i = 0; i < levelSize; i++) {
      const node = queue.shift();
      level.push(node.val);
      if (node.left) queue.push(node.left);
      if (node.right) queue.push(node.right);
    }
    result.push(level);
  }
  return result;
}`,
    },
  },
  {
    id: 25,
    slug: 'validate-binary-search-tree',
    title: 'Validate Binary Search Tree',
    difficulty: 'Medium',
    category: 'Trees',
    tags: ['tree', 'bst', 'dfs', 'recursion'],
    description: `Given the root of a binary tree, determine if it is a valid BST. A valid BST has left subtree values strictly less than root, right subtree values strictly greater than root, and both subtrees are also valid BSTs.`,
    examples: [
      { input: 'root = [2,1,3]', output: 'true', explanation: '1 < 2 < 3, valid BST.' },
      { input: 'root = [5,1,4,null,null,3,6]', output: 'false', explanation: 'Node 4 in right subtree is less than root 5.' },
    ],
    constraints: ['Number of nodes in [1, 10^4]', '-2^31 <= Node.val <= 2^31 - 1'],
    approach: [
      { step: 1, title: 'Track valid range for each node', detail: 'Each node must fall within a (min, max) range. Start with (-Infinity, Infinity) at root.' },
      { step: 2, title: 'Update range as you go deeper', detail: 'When going left, update max = current node val. When going right, update min = current node val.' },
      { step: 3, title: 'Validate at each node', detail: 'If any node\'s value falls outside its valid range, return false.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(h)',
    solution: {
      language: 'javascript',
      code: `function isValidBST(root, min = -Infinity, max = Infinity) {
  if (!root) return true;
  if (root.val <= min || root.val >= max) return false;
  return isValidBST(root.left, min, root.val) &&
         isValidBST(root.right, root.val, max);
}`,
    },
  },
  {
    id: 26,
    slug: 'implement-trie',
    title: 'Implement Trie (Prefix Tree)',
    difficulty: 'Medium',
    category: 'Tries',
    tags: ['trie', 'design', 'string'],
    description: `Implement a trie with \`insert\`, \`search\`, and \`startsWith\` methods. \`insert(word)\` inserts a word. \`search(word)\` returns true if the word is in the trie. \`startsWith(prefix)\` returns true if any word in the trie starts with the given prefix.`,
    examples: [
      { input: 'insert("apple"), search("apple"), search("app"), startsWith("app"), insert("app"), search("app")', output: 'true, false, true, true', explanation: '"app" is only searchable after it is inserted.' },
    ],
    constraints: ['1 <= word.length <= 2000', 'word and prefix consist only of lowercase English letters'],
    approach: [
      { step: 1, title: 'Use a nested object as the trie', detail: 'Each node is an object where keys are characters and a special key (e.g., "#") marks the end of a word.' },
      { step: 2, title: 'Insert character by character', detail: 'For each character, create a child node if it doesn\'t exist, then move down.' },
      { step: 3, title: 'Search and prefix check', detail: 'For search, traverse and check the end marker. For startsWith, traverse without checking the end marker.' },
    ],
    timeComplexity: 'O(m) per operation, m = word length',
    spaceComplexity: 'O(n * m) total',
    solution: {
      language: 'javascript',
      code: `class Trie {
  constructor() {
    this.root = {};
  }

  insert(word) {
    let node = this.root;
    for (const c of word) {
      if (!node[c]) node[c] = {};
      node = node[c];
    }
    node['#'] = true;
  }

  search(word) {
    let node = this.root;
    for (const c of word) {
      if (!node[c]) return false;
      node = node[c];
    }
    return node['#'] === true;
  }

  startsWith(prefix) {
    let node = this.root;
    for (const c of prefix) {
      if (!node[c]) return false;
      node = node[c];
    }
    return true;
  }
}`,
    },
  },
  {
    id: 27,
    slug: 'number-of-islands',
    title: 'Number of Islands',
    difficulty: 'Medium',
    category: 'Graphs',
    tags: ['graph', 'dfs', 'bfs', 'matrix'],
    description: `Given an m×n 2D binary grid representing a map of '1's (land) and '0's (water), return the number of islands. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically.`,
    examples: [
      { input: 'grid = [["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', output: '3', explanation: 'Three separate land masses.' },
    ],
    constraints: ['m == grid.length', '1 <= m, n <= 300'],
    approach: [
      { step: 1, title: 'Iterate through each cell', detail: 'Loop over every cell in the grid. When you find a \'1\', increment the island count.' },
      { step: 2, title: 'Flood fill with DFS', detail: 'Run DFS/BFS from that cell, marking every connected \'1\' as visited (set to \'0\') to avoid counting the same island twice.' },
      { step: 3, title: 'Continue scanning', detail: 'Continue scanning the grid; any unvisited \'1\' found starts a new island.' },
    ],
    timeComplexity: 'O(m × n)',
    spaceComplexity: 'O(m × n) worst case for recursion stack',
    solution: {
      language: 'javascript',
      code: `function numIslands(grid) {
  let count = 0;
  const m = grid.length, n = grid[0].length;

  function dfs(r, c) {
    if (r < 0 || r >= m || c < 0 || c >= n || grid[r][c] !== '1') return;
    grid[r][c] = '0';
    dfs(r + 1, c); dfs(r - 1, c);
    dfs(r, c + 1); dfs(r, c - 1);
  }

  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === '1') {
        count++;
        dfs(r, c);
      }
    }
  }
  return count;
}`,
    },
  },
  {
    id: 28,
    slug: 'clone-graph',
    title: 'Clone Graph',
    difficulty: 'Medium',
    category: 'Graphs',
    tags: ['graph', 'dfs', 'bfs', 'hash-map'],
    description: `Given a reference to a node in a connected undirected graph, return a deep copy (clone) of the graph. Each node contains a val and a list of its neighbors.`,
    examples: [
      { input: 'adjList = [[2,4],[1,3],[2,4],[1,3]]', output: '[[2,4],[1,3],[2,4],[1,3]]', explanation: 'A clone with identical structure but separate node instances.' },
    ],
    constraints: ['Number of nodes in [0, 100]', '1 <= Node.val <= 100', 'Node.val is unique'],
    approach: [
      { step: 1, title: 'Use a visited map', detail: 'Maintain a map from original nodes to their clones to handle cycles and shared references.' },
      { step: 2, title: 'DFS to clone', detail: 'For each node, create a clone if it doesn\'t exist in the map. Then recursively clone all neighbors.' },
      { step: 3, title: 'Connect cloned neighbors', detail: 'Push cloned neighbors into the clone\'s neighbors list.' },
    ],
    timeComplexity: 'O(V + E)',
    spaceComplexity: 'O(V)',
    solution: {
      language: 'javascript',
      code: `function cloneGraph(node) {
  if (!node) return null;
  const visited = new Map();

  function dfs(n) {
    if (visited.has(n)) return visited.get(n);
    const clone = { val: n.val, neighbors: [] };
    visited.set(n, clone);
    for (const neighbor of n.neighbors) {
      clone.neighbors.push(dfs(neighbor));
    }
    return clone;
  }

  return dfs(node);
}`,
    },
  },
  {
    id: 29,
    slug: 'climbing-stairs',
    title: 'Climbing Stairs',
    difficulty: 'Easy',
    category: 'Dynamic Programming',
    tags: ['dp', 'fibonacci', 'memoization'],
    description: `You are climbing a staircase. It takes \`n\` steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?`,
    examples: [
      { input: 'n = 2', output: '2', explanation: '(1+1) or (2)' },
      { input: 'n = 3', output: '3', explanation: '(1+1+1), (1+2), or (2+1)' },
    ],
    constraints: ['1 <= n <= 45'],
    approach: [
      { step: 1, title: 'Recognize the Fibonacci pattern', detail: 'The number of ways to reach step n equals ways(n-1) + ways(n-2), since you can arrive from step n-1 (1 step) or step n-2 (2 steps).' },
      { step: 2, title: 'Iterative bottom-up DP', detail: 'Initialize one = 1 and two = 1 (base cases). Iterate from step 3 to n, computing the next value as one + two, then slide the window.' },
      { step: 3, title: 'Return one', detail: 'After the loop, one holds the answer for n steps.' },
    ],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    solution: {
      language: 'javascript',
      code: `function climbStairs(n) {
  let one = 1, two = 1;
  for (let i = 2; i <= n; i++) {
    const next = one + two;
    two = one;
    one = next;
  }
  return one;
}`,
    },
  },
  {
    id: 30,
    slug: 'coin-change',
    title: 'Coin Change',
    difficulty: 'Medium',
    category: 'Dynamic Programming',
    tags: ['dp', 'bfs', 'bottom-up'],
    description: `You are given an integer array \`coins\` representing coins of different denominations and an integer \`amount\` representing a total amount of money. Return the fewest number of coins needed to make up that amount. If no combination can make the amount, return \`-1\`.`,
    examples: [
      { input: 'coins = [1,5,10,25], amount = 41', output: '4', explanation: '25 + 10 + 5 + 1 = 41 with 4 coins.' },
      { input: 'coins = [2], amount = 3', output: '-1', explanation: 'Cannot make 3 with only 2-denomination coins.' },
    ],
    constraints: ['1 <= coins.length <= 12', '1 <= coins[i] <= 2^31 - 1', '0 <= amount <= 10^4'],
    approach: [
      { step: 1, title: 'Build a DP array', detail: 'Create dp[0..amount] initialized to Infinity. Set dp[0] = 0 (zero coins needed to make amount 0).' },
      { step: 2, title: 'Fill the DP table', detail: 'For each amount from 1 to amount, try each coin. If coin <= current amount, dp[i] = min(dp[i], dp[i - coin] + 1).' },
      { step: 3, title: 'Return result', detail: 'dp[amount] holds the answer. Return -1 if it is still Infinity.' },
    ],
    timeComplexity: 'O(amount × coins.length)',
    spaceComplexity: 'O(amount)',
    solution: {
      language: 'javascript',
      code: `function coinChange(coins, amount) {
  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;
  for (let i = 1; i <= amount; i++) {
    for (const coin of coins) {
      if (coin <= i) {
        dp[i] = Math.min(dp[i], dp[i - coin] + 1);
      }
    }
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}`,
    },
  },
];

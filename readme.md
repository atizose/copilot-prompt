## parse_prompt.js从copilot源码extension.js 中抽取prompt
1. 使用parse_prompt.js文件从extension.js中找到类名包含'PromptElement'的类
2. 获取父类以及递归的祖先类的代码实现
3. 对找到的变量，获取类变量及方法定义中使用到的extension.js 的变量、属性和方法名称，从extension.js 中找到这些变量、属性和方法名称对应的具体实现的代码
4. 基于引用，采用prompt.template组织上下文，让大模型解析代码生成可能的Prompt

## promptskill.html是copilot中部分角色定义
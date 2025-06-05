import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

// 添加NodeJS类型定义
declare global {
  namespace NodeJS {
    interface Timeout {}
  }
}

// 定义消息类型，增加thinkContent和mainContent字段
interface Message {
  type: 'user' | 'ai';
  content: string;
  thinkContent?: string;
  mainContent?: string;
}

// 高级HTML实体解码
function decodeHtmlEntities(text: string) {
  // 首先处理常见的错误编码
  let processedText = text
    // 处理错误的编码序列
    .replace(/;amp;gt/g, '>')
    .replace(/;amp;lt/g, '<')
    .replace(/;amp;/g, '&')
    // 处理常见实体
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  
  try {
    // 使用DOMParser进行更彻底的解码
    const doc = new DOMParser().parseFromString(processedText, 'text/html');
    return doc.documentElement.textContent || processedText;
  } catch (e) {
    console.error('DOMParser解码失败，使用基本替换', e);
    return processedText;
  }
}

// 处理多层嵌套的data:前缀
function removeDataPrefixes(text: string): string {
  // 基本情况：如果文本不包含data:，直接返回
  if (!text.includes('data:')) {
    return text;
  }
  
  // 先处理最简单的情况：文本以data:开头
  if (text.startsWith('data:')) {
    // 移除前缀后递归处理剩余部分
    const result = removeDataPrefixes(text.substring(5));
    console.log(`移除开头data:前缀，从 "${text}" 到 "${result}"`);
    return result;
  }
  
  // 处理可能存在的data:位于文本中间的情况
  const parts = text.split('data:');
  
  // 如果只有一部分，说明没有data:，直接返回
  if (parts.length === 1) {
    return text;
  }
  
  // 对每个部分递归处理，然后重新组合
  // 保留第一部分，其余部分递归处理
  const processedParts = [parts[0]];
  
  for (let i = 1; i < parts.length; i++) {
    processedParts.push(removeDataPrefixes(parts[i]));
  }
  
  const result = processedParts.join('');
  console.log(`处理拆分data:，从 "${text}" 到 "${result}"`);
  return result;
}

// 将Markdown格式转换为HTML
function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

// 提取并处理think标签内容
function extractThinkContent(text: string, isPending: boolean = false): { thinkContent: string | undefined, mainContent: string } {
  console.log('📋 extractThinkContent处理文本:', text, '是否处于pending状态:', isPending);
  
  // 检查是否有完整的<think>标签
  const completeThinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const completeMatch = completeThinkRegex.exec(text);
  
  // 如果有完整的标签，按原来的方式处理
  if (completeMatch) {
    const thinkContent = completeMatch[1].trim();
    const mainContent = text.replace(completeMatch[0], '').trim();
    
    console.log('✅ 提取到完整think内容:', thinkContent);
    console.log('📄 主要内容:', mainContent);
    
    return {
      thinkContent,
      mainContent
    };
  }
  
  // 检查是否是开始标签
  if (text.includes('<think>')) {
    // 提取开始标签后的内容
    const startParts = text.split('<think>');
    // 如果有多个部分，第一部分是主内容，其余部分合并为思考内容
    const mainContent = startParts[0].trim();
    const thinkPartial = startParts.length > 1 ? startParts.slice(1).join('<think>').trim() : '';
    
    console.log('🟢 检测到开始think标签，思考部分:', thinkPartial);
    console.log('🟢 检测到开始think标签，主要内容:', mainContent);
    
    return {
      thinkContent: thinkPartial,
      mainContent
    };
  }
  
  // 检查是否是结束标签
  if (text.includes('</think>')) {
    // 提取结束标签前的内容
    const endParts = text.split('</think>');
    const thinkPartial = endParts[0].trim();
    // 结束标签后的所有内容作为主内容
    const mainContent = endParts.slice(1).join('</think>').trim();
    
    console.log('🔴 检测到结束think标签，思考部分:', thinkPartial);
    console.log('🔴 检测到结束think标签，主要内容:', mainContent);
    
    return {
      thinkContent: thinkPartial,
      mainContent
    };
  }
  
  // 如果是处于思考模式中，并且没有标签，则整个内容都是思考内容
  if (isPending) {
    console.log('🟡 处于思考模式中，添加到思考内容:', text);
    return {
      thinkContent: text,
      mainContent: ''
    };
  }
  
  // 如果没有匹配到任何标签，并且不在思考模式中，则整个内容都是主要内容
  console.log('⚪ 没有匹配到标签，作为主要内容:', text);
  return {
    thinkContent: undefined,
    mainContent: text
  };
}

// 预处理响应文本
function preprocessResponseText(text: string, pendingThink: string = '', isThinking: boolean = false) {
  console.log('原始文本:', text);
  console.log('现有思考内容:', pendingThink, '是否处于思考状态:', isThinking);
  
  // 移除data:前缀
  const withoutDataPrefix = removeDataPrefixes(text);
  console.log('移除data:前缀后:', withoutDataPrefix);
  
  // 解码HTML实体
  let decodedText = withoutDataPrefix;
  let prevText = '';
  const maxIterations = 5;
  let iterations = 0;
  
  while (decodedText !== prevText && iterations < maxIterations) {
    prevText = decodedText;
    decodedText = decodeHtmlEntities(decodedText);
    iterations++;
  }
  
  console.log('解码HTML实体后:', decodedText);
  
  // 检查是否包含开始或结束标签
  const hasStartTag = decodedText.includes('<think>');
  const hasEndTag = decodedText.includes('</think>');
  
  // 记录标签状态
  if (hasStartTag) console.log('⚠️ 预处理: 检测到<think>标签');
  if (hasEndTag) console.log('⚠️ 预处理: 检测到</think>标签');
  if (isThinking) console.log('⚠️ 预处理: 当前处于思考状态中');
  
  // 初始化变量
  let thinkContent = '';
  let mainContent = '';
  let newThinkingState = isThinking;
  
  // 处理各种标签情况
  if (hasStartTag && hasEndTag) {
    // 同时包含开始和结束标签，提取标签内容为思考内容，标签外内容为主内容
    const regex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    let remainingText = decodedText;
    let extractedThinking = '';
    
    while ((match = regex.exec(decodedText)) !== null) {
      // 获取标签前的文本作为主内容
      const beforeTag = remainingText.substring(0, remainingText.indexOf('<think>'));
      mainContent += beforeTag;
      
      // 获取标签内的文本作为思考内容
      extractedThinking += match[1];
      
      // 更新剩余文本为标签后的部分
      remainingText = remainingText.substring(remainingText.indexOf('</think>') + 9);
    }
    
    // 添加最后剩余的文本到主内容
    mainContent += remainingText;
    thinkContent = extractedThinking;
    
    // 完整标签处理完后，退出思考状态
    newThinkingState = false;
    console.log('🔄 同时包含开始和结束标签，思考内容:', thinkContent);
    console.log('🔄 同时包含开始和结束标签，主要内容:', mainContent);
  } else if (hasStartTag) {
    // 只有开始标签，进入思考状态
    const parts = decodedText.split('<think>');
    mainContent = parts[0]; // 标签前的内容
    
    if (parts.length > 1) {
      thinkContent = parts.slice(1).join('<think>'); // 标签后的内容作为思考内容
    }
    
    // 进入思考状态
    newThinkingState = true;
    console.log('🟢 检测到开始标签，进入思考状态');
    console.log('🟢 检测到开始标签，思考内容:', thinkContent);
    console.log('🟢 检测到开始标签，主要内容:', mainContent);
  } else if (hasEndTag) {
    // 只有结束标签，退出思考状态
    const parts = decodedText.split('</think>');
    thinkContent = parts[0]; // 结束标签前的内容是思考内容
    
    if (parts.length > 1) {
      mainContent = parts.slice(1).join('</think>'); // 结束标签后的内容是主内容
    }
    
    // 退出思考状态
    newThinkingState = false;
    console.log('🔴 检测到结束标签，退出思考状态');
    console.log('🔴 检测到结束标签，思考内容:', thinkContent);
    console.log('🔴 检测到结束标签，主要内容:', mainContent);
  } else if (isThinking) {
    // 如果没有任何标签，但当前在思考状态中，则所有内容都是思考内容
    thinkContent = decodedText;
    mainContent = '';
    newThinkingState = true; // 确保状态保持
    console.log('🟡 没有标签但在思考状态中，所有内容作为思考内容:', thinkContent);
  } else {
    // 如果没有任何标签，且不在思考状态，则所有内容都是主内容
    thinkContent = '';
    mainContent = decodedText;
    newThinkingState = false; // 确保状态保持
    console.log('⚪ 没有标签且不在思考状态中，所有内容作为主内容:', mainContent);
  }
  
  // 组合现有的思考内容和新的思考内容
  let combinedThinkContent = pendingThink || '';
  
  if (thinkContent) {
    combinedThinkContent += thinkContent;
  }
  
  console.log('组合后的思考内容:', combinedThinkContent);
  console.log('主要内容:', mainContent);
  console.log('更新后的思考状态:', newThinkingState);
  
  return {
    thinkContent: combinedThinkContent || undefined,
    mainContent,
    hasThinkTag: newThinkingState
  };
}

export default function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const typingTimer = useRef<NodeJS.Timeout>();
  
  // 处理流式思考内容的状态
  const [pendingThinkContent, setPendingThinkContent] = useState<string>('');
  const [hasThinkTag, setHasThinkTag] = useState<boolean>(false);

  const processTyping = useCallback((text: string) => {
    // 预处理文本，考虑现有的思考状态
    const { thinkContent, mainContent, hasThinkTag: newHasThinkTag } = preprocessResponseText(text, pendingThinkContent, hasThinkTag);
    
    // 如果思考状态有变化，更新状态
    if (newHasThinkTag !== hasThinkTag) {
      console.log(`💡 思考状态变化: ${hasThinkTag ? '思考中' : '非思考'} -> ${newHasThinkTag ? '思考中' : '非思考'}`);
      setHasThinkTag(newHasThinkTag);
    }
    
    // 更新思考内容
    setPendingThinkContent(thinkContent || '');
    
    // 过滤控制字符，保留表情符号
    const filteredMainContent = mainContent
      ? mainContent.replace(/[\x00-\x1F\x7F-\x9F]/g, '') // 移除控制字符
      : '';
    
    setMessages(prevMsgs => {
      const lastMsg = prevMsgs[prevMsgs.length - 1];
      if (lastMsg?.type === 'ai') {
        // 更新主要内容
        const updatedMainContent = (lastMsg.mainContent || '') + filteredMainContent;
        
        // 显示内容添加光标
        const displayContent = updatedMainContent + '▎';
        
        return [...prevMsgs.slice(0, -1), {
          ...lastMsg,
          content: displayContent,
          thinkContent: thinkContent, // 直接使用当前循环的思考内容
          mainContent: updatedMainContent
        }];
      }
      return prevMsgs;
    });
  }, [pendingThinkContent, hasThinkTag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 立即添加用户消息
    setMessages(prev => [...prev, {type: 'user', content: input}]);
    setInput('');
    setIsLoading(true);
    
    // 重置思考状态 - 确保打印日志
    console.log('🔄 🔄 提交新请求，重置思考状态');
    setPendingThinkContent('');
    setHasThinkTag(false);

    // 添加初始AI消息
    setMessages(prev => [...prev, {
      type: 'ai', 
      content: '▎', 
      thinkContent: undefined,
      mainContent: ''
    }]);

    try {
      const response = await fetch('/ai/generateStream', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: input , conversationId: "gang.chen" })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      console.log('开始接收流式响应...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('流式响应结束');
          break;
        }
        
        // 累积到缓冲区
        buffer += decoder.decode(value, { stream: true });
        console.log('接收到原始数据:', buffer);
        
        // 按SSE格式分割事件
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        
        for (const event of events) {
          // 先清理event中的多余data:前缀
          const cleanedEvent = removeDataPrefixes(event);
          console.log('清理后的事件数据:', cleanedEvent);
          
          // 如果清理后的事件不为空，处理事件
          if (cleanedEvent.trim()) {
            console.log('处理清理后的数据:', cleanedEvent);
            
            // 检查是否包含思考标签并直接更新状态
            // 这确保即使前面的逻辑有问题，也能正确设置思考状态
            if (cleanedEvent.includes('<think>')) {
              console.log('🟢🟢 事件包含思考开始标签，强制进入思考模式');
              setHasThinkTag(true);
            } else if (cleanedEvent.includes('</think>')) {
              console.log('🔴🔴 事件包含思考结束标签，强制退出思考模式');
              setHasThinkTag(false);
            }
            
            // 正常处理文本内容
            processTyping(cleanedEvent);
          }
        }
      }

      // 流式结束移除光标
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg?.type === 'ai') {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            content: lastMsg.content.replace(/▎$/, '')
          }];
        }
        return prev;
      });
    } catch (error) {
      console.error('Stream error:', error);
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg?.type === 'ai') {
          return [...prev.slice(0, -1), {
            ...lastMsg,
            content: 'Error: 连接流式接口失败'
          }];
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 格式化消息内容为HTML
  const formatMessageContent = useCallback((content: string) => {
    return markdownToHtml(content);
  }, []);

  return (
    <div className="app-container">
      <div className="message-container">
        <div className="messages-wrapper">
          {messages.map((msg, index) => (
            <div key={index} className={`message-item ${msg.type === 'user' ? 'user-message' : 'ai-message'}`}>
              <div className="avatar"></div>
              <div className="message-bubble">
                {msg.type === 'ai' && msg.thinkContent && (
                  <div className="think-block">
                    <div className="think-label">思考内容:</div>
                    <div 
                      className="think-content"
                      dangerouslySetInnerHTML={{ __html: formatMessageContent(msg.thinkContent) }} 
                    />
                  </div>
                )}
                
                {msg.type === 'ai' && msg.thinkContent && (
                  <div className="content-separator">
                    <hr />
                  </div>
                )}
                
                <div className={msg.thinkContent ? 'main-content' : ''}>
                  {msg.type === 'ai' && msg.thinkContent && <div className="reply-label">回复内容:</div>}
                  <div 
                    className="reply-content"
                    dangerouslySetInnerHTML={{ 
                      __html: formatMessageContent(msg.content.replace(/▎$/, '')) 
                    }} 
                  />
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="input-footer">
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题"
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? '发送中…' : '发送'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

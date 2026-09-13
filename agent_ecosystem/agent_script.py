import requests
import json
import time
import base64
from datetime import datetime
from typing import List, Dict

class ValidatorAgent:
    def validate_m3u8_links(self, channels: List[Dict[str, str]]) -> List[Dict[str, str]]:
        valid_channels = []
        for channel in channels:
            url = channel.get('url', '')
            if not url.endswith('.m3u8'):
                continue
            try:
                start_time = time.time()
                response = requests.get(url, timeout=10)
                response_time = time.time() - start_time

                if response.status_code == 200 and response_time < 5:
                    content = response.text
                    if '#EXTM3U' in content and '#EXTINF' in content:
                        valid_channels.append(channel)
            except Exception:
                continue
        return valid_channels

class SanitizerAgent:
    def sanitize_channels(self, channels: List[Dict[str, str]]) -> List[Dict[str, str]]:
        seen_urls = set()
        unique_channels = []
        for channel in channels:
            url = channel.get('url', '').strip()
            name = channel.get('name', '').strip()
            if url and name and url not in seen_urls:
                seen_urls.add(url)
                unique_channels.append({'name': name, 'url': url})
        unique_channels.sort(key=lambda x: x['name'])
        return unique_channels

class DeployerAgent:
    def deploy_to_github(self, channels: List[Dict[str, str]], github_token: str, repo_owner: str, repo_name: str, branch: str = 'main'):
        url = f'https://api.github.com/repos/{repo_owner}/{repo_name}/contents/channels.json'
        headers = {
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }

        # Get current file SHA if exists
        response = requests.get(url, headers=headers)
        sha = None
        if response.status_code == 200:
            sha = response.json().get('sha')

        content = json.dumps(channels, indent=2, ensure_ascii=False)
        encoded_content = base64.b64encode(content.encode('utf-8')).decode('utf-8')

        data = {
            'message': f'Update channels.json - {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
            'content': encoded_content,
            'branch': branch
        }
        if sha:
            data['sha'] = sha

        response = requests.put(url, headers=headers, json=data)
        return response.status_code in [200, 201]

def main():
    # Example usage - in practice, these would come from configuration/environment
    GITHUB_TOKEN = 'your_github_token_here'
    REPO_OWNER = 'your_username'
    REPO_NAME = 'your_repo'
    BRANCH = 'main'

    # Initial channels list (would typically come from a source)
    initial_channels = [
        {'name': 'Example Channel 1', 'url': 'https://example.com/stream1.m3u8'},
        {'name': 'Example Channel 2', 'url': 'https://example.com/stream2.m3u8'},
    ]

    # Run agent pipeline
    validator = ValidatorAgent()
    sanitizer = SanitizerAgent()
    deployer = DeployerAgent()

    validated_channels = validator.validate_m3u8_links(initial_channels)
    sanitized_channels = sanitizer.sanitize_channels(validated_channels)
    success = deployer.deploy_to_github(sanitized_channels, GITHUB_TOKEN, REPO_OWNER, REPO_NAME, BRANCH)

    if success:
        print('Successfully deployed channels.json to GitHub')
    else:
        print('Failed to deploy channels.json to GitHub')

if __name__ == '__main__':
    main()
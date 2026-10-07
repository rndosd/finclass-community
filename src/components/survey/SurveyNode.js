import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import SurveyComponent from './SurveyComponent';

export default Node.create({
    name: 'survey',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            surveyId: {
                default: null,
                parseHTML: element => {
                    return element.getAttribute('data-survey-id');
                },
                renderHTML: attributes => {
                    if (!attributes.surveyId) return {};
                    return {
                        'data-survey-id': attributes.surveyId,
                    };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-survey-id]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes];
    },

    addNodeView() {
        return ReactNodeViewRenderer(SurveyComponent);
    },

    addCommands() {
        return {
            setSurvey: (surveyId) => ({ commands }) => {
                return commands.insertContent({
                    type: this.name,
                    attrs: {
                        surveyId,
                    },
                });
            },
        };
    },
});